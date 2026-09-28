import { Migration } from "@mikro-orm/migrations";

export class Migration20260925101109 extends Migration {
    public async up(): Promise<void> {
        this.addSql(`CREATE TYPE "custom_field_target" AS enum('per_proposal', 'per_host');`);
        this.addSql(`
            CREATE TYPE "custom_field_requirement" AS enum(
                'always_optional',
                'always_required',
                'required_after_deadline'
            );
        `);
        this.addSql(`
            CREATE TYPE "job_state" AS enum(
                'available',
                'running',
                'retryable',
                'scheduled',
                'completed',
                'canceled',
                'discarded'
            );
        `);
        this.addSql(`CREATE TYPE "team_role" AS enum('admin', 'manager', 'viewer');`);
        this.addSql(`
            CREATE TYPE "session_state" AS enum(
                'submitted',
                'accepted',
                'confirmed',
                'rejected',
                'withdrawn',
                'canceled'
            );
        `);
        this.addSql(`
            CREATE TABLE "edition" (
                "id" uuid NOT NULL,
                "version" int NOT NULL DEFAULT 1,
                "name" text NOT NULL,
                "start_date" date NOT NULL,
                "end_date" date NOT NULL,
                "time_zone" text NOT NULL,
                "submission_deadline" timestamptz NULL,
                "session_field_options" jsonb NOT NULL,
                "profile_field_options" jsonb NOT NULL,
                PRIMARY KEY ("id")
            );
        `);

        this.addSql(`
            CREATE TABLE "custom_field" (
                "id" uuid NOT NULL,
                "external_key" text NULL,
                "target" "custom_field_target" NOT NULL,
                "options" jsonb NOT NULL,
                "requirement" "custom_field_requirement" NOT NULL,
                "title" text NOT NULL,
                "helper_text" text NOT NULL,
                "deadline" timestamptz NULL,
                "freeze_after" timestamptz NULL,
                "confidential" boolean NOT NULL,
                "position" int NOT NULL,
                "edition_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "custom_field_edition_id_id_index" ON "custom_field" ("edition_id", "id");`,
        );
        this.addSql(`
            ALTER TABLE "custom_field"
            ADD CONSTRAINT "custom_field_edition_id_target_external_key_unique" UNIQUE ("edition_id", "target", "external_key");
        `);
        this.addSql(`
            ALTER TABLE "custom_field"
            ADD CONSTRAINT "custom_field_edition_id_target_position_unique" UNIQUE ("edition_id", "target", "position")
            DEFERRABLE INITIALLY DEFERRED;
        `);

        this.addSql(`
            CREATE TABLE "edition_revision" (
                "edition_id" uuid NOT NULL,
                "revision" int NOT NULL,
                PRIMARY KEY ("edition_id")
            );
        `);

        this.addSql(`
            CREATE TABLE "file_deletion_candidate" (
                "key" text NOT NULL,
                "marked_at" timestamptz NOT NULL,
                PRIMARY KEY ("key")
            );
        `);

        this.addSql(`
            CREATE TABLE "job" (
                "id" uuid NOT NULL,
                "created_at" timestamptz NOT NULL,
                "attempted_at" timestamptz NULL,
                "scheduled_at" timestamptz NOT NULL,
                "finalized_at" timestamptz NULL,
                "attempt" int NOT NULL,
                "state" "job_state" NOT NULL,
                "last_error" text NULL,
                "payload" jsonb NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "job_state_attempted_at_index" ON "job" ("state", "attempted_at");`,
        );
        this.addSql(
            `CREATE INDEX "job_state_finalized_at_index" ON "job" ("state", "finalized_at");`,
        );
        this.addSql(
            `CREATE INDEX "job_state_scheduled_at_index" ON "job" ("state", "scheduled_at");`,
        );

        this.addSql(`
            CREATE TABLE "location" (
                "id" uuid NOT NULL,
                "name" text NOT NULL,
                "external_key" text NULL,
                "position" int NOT NULL,
                "edition_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "location_edition_id_id_index" ON "location" ("edition_id", "id");`,
        );
        this.addSql(`
            ALTER TABLE "location"
            ADD CONSTRAINT "location_edition_id_position_unique" UNIQUE ("edition_id", "position")
            DEFERRABLE INITIALLY DEFERRED;
        `);
        this.addSql(`
            ALTER TABLE "location"
            ADD CONSTRAINT "location_edition_id_external_key_unique" UNIQUE ("edition_id", "external_key");
        `);

        this.addSql(`
            CREATE TABLE "location_availability" (
                "id" uuid NOT NULL,
                "starts_at" timestamptz NOT NULL,
                "ends_at" timestamptz NOT NULL,
                "location_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "location_availability_location_id_index" ON "location_availability" ("location_id");`,
        );

        this.addSql(`
            CREATE TABLE "schedule" (
                "id" uuid NOT NULL,
                "sequence" int NOT NULL,
                "created_at" timestamptz NOT NULL,
                "published_at" timestamptz NULL,
                "start_date" date NULL,
                "end_date" date NULL,
                "time_zone" text NULL,
                "preliminary" boolean NOT NULL,
                "edition_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "schedule_edition_id_id_index" ON "schedule" ("edition_id", "id");`,
        );
        this.addSql(`
            ALTER TABLE "schedule"
            ADD CONSTRAINT "schedule_edition_id_sequence_unique" UNIQUE ("edition_id", "sequence");
        `);
        this.addSql(`
            ALTER TABLE "schedule"
            ADD CONSTRAINT "schedule_check" CHECK (
                num_nonnulls (published_at, start_date, end_date, time_zone) IN (0, 4)
            );
        `);

        this.addSql(`
            CREATE TABLE "session_type" (
                "id" uuid NOT NULL,
                "name" text NOT NULL,
                "external_key" text NULL,
                "default_duration" interval NOT NULL,
                "internal" boolean NOT NULL,
                "selection_default" boolean NOT NULL,
                "edition_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(`
            CREATE UNIQUE INDEX unique_selection_default_per_edition ON session_type (edition_id, selection_default)
            WHERE
                selection_default = TRUE;
        `);
        this.addSql(
            `CREATE INDEX "session_type_edition_id_id_index" ON "session_type" ("edition_id", "id");`,
        );
        this.addSql(`
            ALTER TABLE "session_type"
            ADD CONSTRAINT "session_type_edition_id_external_key_unique" UNIQUE ("edition_id", "external_key");
        `);

        this.addSql(`
            CREATE TABLE "custom_field_session_types" (
                "custom_field_id" uuid NOT NULL,
                "session_type_id" uuid NOT NULL,
                PRIMARY KEY ("custom_field_id", "session_type_id")
            );
        `);

        this.addSql(`
            CREATE TABLE "team" (
                "id" uuid NOT NULL,
                "name" text NOT NULL,
                "role" "team_role" NOT NULL,
                PRIMARY KEY ("id")
            );
        `);

        this.addSql(`
            CREATE TABLE "team_invite" (
                "id" uuid NOT NULL,
                "created_at" timestamptz NOT NULL,
                "email_address" text NOT NULL,
                "code" text NOT NULL,
                "team_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(`CREATE INDEX "team_invite_team_id_index" ON "team_invite" ("team_id");`);
        this.addSql(`
            ALTER TABLE "team_invite"
            ADD CONSTRAINT "team_invite_team_id_email_address_unique" UNIQUE ("team_id", "email_address");
        `);

        this.addSql(`
            CREATE TABLE "track" (
                "id" uuid NOT NULL,
                "name" text NOT NULL,
                "external_key" text NULL,
                "description" text NOT NULL,
                "color" char(7) NOT NULL,
                "internal" boolean NOT NULL,
                "edition_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(`CREATE INDEX "track_edition_id_id_index" ON "track" ("edition_id", "id");`);
        this.addSql(`
            ALTER TABLE "track"
            ADD CONSTRAINT "track_edition_id_external_key_unique" UNIQUE ("edition_id", "external_key");
        `);
        this.addSql(`
            ALTER TABLE "track"
            ADD CONSTRAINT "track_color_check" CHECK (color ~ '^#[0-9A-Fa-f]{6}$');
        `);

        this.addSql(`
            CREATE TABLE "session" (
                "id" uuid NOT NULL,
                "state" "session_state" NOT NULL,
                "created_at" timestamptz NOT NULL,
                "updated_at" timestamptz NOT NULL,
                "confirmation_reminded_at" timestamptz NULL,
                "title" text NOT NULL,
                "abstract" text NOT NULL,
                "description" text NOT NULL,
                "notes" text NOT NULL,
                "duration" interval NULL,
                "setup_time" interval NULL,
                "teardown_time" interval NULL,
                "teaser_image" jsonb NULL,
                "edition_id" uuid NOT NULL,
                "session_type_id" uuid NOT NULL,
                "track_id" uuid NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "session_session_type_id_index" ON "session" ("session_type_id");`,
        );
        this.addSql(
            `CREATE INDEX "session_edition_id_state_index" ON "session" ("edition_id", "state");`,
        );
        this.addSql(
            `CREATE INDEX "session_edition_id_created_at_index" ON "session" ("edition_id", "created_at");`,
        );
        this.addSql(
            `CREATE INDEX "session_edition_id_id_index" ON "session" ("edition_id", "id");`,
        );

        this.addSql(`
            CREATE TABLE "slot" (
                "id" uuid NOT NULL,
                "stable_id" uuid NOT NULL,
                "starts_at" timestamptz NOT NULL,
                "ends_at" timestamptz NOT NULL,
                "setup_time" interval NOT NULL,
                "teardown_time" interval NOT NULL,
                "schedule_id" uuid NOT NULL,
                "session_id" uuid NOT NULL,
                "location_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "slot_schedule_id_location_id_index" ON "slot" ("schedule_id", "location_id");`,
        );
        this.addSql(`
            ALTER TABLE "slot"
            ADD CONSTRAINT "slot_stable_id_schedule_id_unique" UNIQUE ("stable_id", "schedule_id");
        `);

        this.addSql(`
            CREATE TABLE "custom_field_tracks" (
                "custom_field_id" uuid NOT NULL,
                "track_id" uuid NOT NULL,
                PRIMARY KEY ("custom_field_id", "track_id")
            );
        `);

        this.addSql(`
            CREATE TABLE "user" (
                "id" uuid NOT NULL,
                "external_id" text NOT NULL,
                "last_seen_at" timestamptz NOT NULL,
                "display_name" text NOT NULL,
                "email_address" text NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(`
            ALTER TABLE "user"
            ADD CONSTRAINT "user_external_id_unique" UNIQUE ("external_id");
        `);

        this.addSql(`
            CREATE TABLE "team_users" (
                "team_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                PRIMARY KEY ("team_id", "user_id")
            );
        `);

        this.addSql(`
            CREATE TABLE "session_transition" (
                "id" uuid NOT NULL,
                "created_at" timestamptz NOT NULL,
                "session_id" uuid NOT NULL,
                "actor_id" uuid NULL,
                "from_state" "session_state" NOT NULL,
                "to_state" "session_state" NOT NULL,
                "note" text NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "session_transition_session_id_created_at_index" ON "session_transition" ("session_id", "created_at");`,
        );

        this.addSql(`
            CREATE TABLE "session_host_invite" (
                "id" uuid NOT NULL,
                "created_at" timestamptz NOT NULL,
                "revoked_at" timestamptz NULL,
                "email_address" text NOT NULL,
                "code" text NOT NULL,
                "session_id" uuid NOT NULL,
                "created_by_id" uuid NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "session_host_invite_session_id_index" ON "session_host_invite" ("session_id");`,
        );
        this.addSql(
            `CREATE INDEX "session_host_invite_created_by_id_index" ON "session_host_invite" ("created_by_id");`,
        );
        this.addSql(`
            CREATE UNIQUE INDEX unique_live_session_host_invite ON session_host_invite (session_id, email_address)
            WHERE
                revoked_at IS NULL;
        `);

        this.addSql(`
            CREATE TABLE "pending_upload" (
                "key" text NOT NULL,
                "user_id" uuid NOT NULL,
                "created_at" timestamptz NOT NULL,
                PRIMARY KEY ("key")
            );
        `);
        this.addSql(`CREATE INDEX "pending_upload_user_id_index" ON "pending_upload" ("user_id");`);

        this.addSql(`
            CREATE TABLE "host" (
                "id" uuid NOT NULL,
                "display_name" text NOT NULL,
                "email_address" text NOT NULL,
                "biography" text NOT NULL,
                "avatar" jsonb NULL,
                "edition_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(`CREATE INDEX "host_user_id_index" ON "host" ("user_id");`);
        this.addSql(`CREATE INDEX "host_edition_id_id_index" ON "host" ("edition_id", "id");`);
        this.addSql(`
            ALTER TABLE "host"
            ADD CONSTRAINT "host_edition_id_user_id_unique" UNIQUE ("edition_id", "user_id");
        `);

        this.addSql(`
            CREATE TABLE "session_hosts" (
                "session_id" uuid NOT NULL,
                "host_id" uuid NOT NULL,
                PRIMARY KEY ("session_id", "host_id")
            );
        `);

        this.addSql(`
            CREATE TABLE "response" (
                "id" uuid NOT NULL,
                "value" jsonb NULL,
                "custom_field_id" uuid NOT NULL,
                "host_id" uuid NULL,
                "session_id" uuid NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "response_custom_field_id_index" ON "response" ("custom_field_id");`,
        );
        this.addSql(`CREATE INDEX "response_host_id_index" ON "response" ("host_id");`);
        this.addSql(`CREATE INDEX "response_session_id_index" ON "response" ("session_id");`);
        this.addSql(`
            ALTER TABLE "response"
            ADD CONSTRAINT "response_custom_field_id_session_id_unique" UNIQUE ("custom_field_id", "session_id");
        `);
        this.addSql(`
            ALTER TABLE "response"
            ADD CONSTRAINT "response_custom_field_id_host_id_unique" UNIQUE ("custom_field_id", "host_id");
        `);
        this.addSql(`
            ALTER TABLE "response"
            ADD CONSTRAINT "response_check" CHECK ((host_id IS NULL) <> (session_id IS NULL));
        `);

        this.addSql(`
            CREATE TABLE "host_availability" (
                "id" uuid NOT NULL,
                "starts_at" timestamptz NOT NULL,
                "ends_at" timestamptz NOT NULL,
                "host_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        this.addSql(
            `CREATE INDEX "host_availability_host_id_index" ON "host_availability" ("host_id");`,
        );

        this.addSql(`
            ALTER TABLE "custom_field"
            ADD CONSTRAINT "custom_field_edition_id_foreign" FOREIGN key ("edition_id") REFERENCES "edition" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "location"
            ADD CONSTRAINT "location_edition_id_foreign" FOREIGN key ("edition_id") REFERENCES "edition" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "location_availability"
            ADD CONSTRAINT "location_availability_location_id_foreign" FOREIGN key ("location_id") REFERENCES "location" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "schedule"
            ADD CONSTRAINT "schedule_edition_id_foreign" FOREIGN key ("edition_id") REFERENCES "edition" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "session_type"
            ADD CONSTRAINT "session_type_edition_id_foreign" FOREIGN key ("edition_id") REFERENCES "edition" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "custom_field_session_types"
            ADD CONSTRAINT "custom_field_session_types_custom_field_id_foreign" FOREIGN key ("custom_field_id") REFERENCES "custom_field" ("id") ON UPDATE CASCADE ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "custom_field_session_types"
            ADD CONSTRAINT "custom_field_session_types_session_type_id_foreign" FOREIGN key ("session_type_id") REFERENCES "session_type" ("id") ON UPDATE CASCADE ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "team_invite"
            ADD CONSTRAINT "team_invite_team_id_foreign" FOREIGN key ("team_id") REFERENCES "team" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "track"
            ADD CONSTRAINT "track_edition_id_foreign" FOREIGN key ("edition_id") REFERENCES "edition" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "session"
            ADD CONSTRAINT "session_edition_id_foreign" FOREIGN key ("edition_id") REFERENCES "edition" ("id") ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "session"
            ADD CONSTRAINT "session_session_type_id_foreign" FOREIGN key ("session_type_id") REFERENCES "session_type" ("id");
        `);
        this.addSql(`
            ALTER TABLE "session"
            ADD CONSTRAINT "session_track_id_foreign" FOREIGN key ("track_id") REFERENCES "track" ("id") ON DELETE SET NULL;
        `);

        this.addSql(`
            ALTER TABLE "slot"
            ADD CONSTRAINT "slot_schedule_id_foreign" FOREIGN key ("schedule_id") REFERENCES "schedule" ("id") ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "slot"
            ADD CONSTRAINT "slot_session_id_foreign" FOREIGN key ("session_id") REFERENCES "session" ("id");
        `);
        this.addSql(`
            ALTER TABLE "slot"
            ADD CONSTRAINT "slot_location_id_foreign" FOREIGN key ("location_id") REFERENCES "location" ("id");
        `);

        this.addSql(`
            ALTER TABLE "custom_field_tracks"
            ADD CONSTRAINT "custom_field_tracks_custom_field_id_foreign" FOREIGN key ("custom_field_id") REFERENCES "custom_field" ("id") ON UPDATE CASCADE ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "custom_field_tracks"
            ADD CONSTRAINT "custom_field_tracks_track_id_foreign" FOREIGN key ("track_id") REFERENCES "track" ("id") ON UPDATE CASCADE ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "team_users"
            ADD CONSTRAINT "team_users_team_id_foreign" FOREIGN key ("team_id") REFERENCES "team" ("id") ON UPDATE CASCADE ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "team_users"
            ADD CONSTRAINT "team_users_user_id_foreign" FOREIGN key ("user_id") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "session_transition"
            ADD CONSTRAINT "session_transition_session_id_foreign" FOREIGN key ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "session_transition"
            ADD CONSTRAINT "session_transition_actor_id_foreign" FOREIGN key ("actor_id") REFERENCES "user" ("id") ON DELETE SET NULL;
        `);

        this.addSql(`
            ALTER TABLE "session_host_invite"
            ADD CONSTRAINT "session_host_invite_session_id_foreign" FOREIGN key ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "session_host_invite"
            ADD CONSTRAINT "session_host_invite_created_by_id_foreign" FOREIGN key ("created_by_id") REFERENCES "user" ("id") ON DELETE SET NULL;
        `);

        this.addSql(`
            ALTER TABLE "pending_upload"
            ADD CONSTRAINT "pending_upload_user_id_foreign" FOREIGN key ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "host"
            ADD CONSTRAINT "host_edition_id_foreign" FOREIGN key ("edition_id") REFERENCES "edition" ("id") ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "host"
            ADD CONSTRAINT "host_user_id_foreign" FOREIGN key ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "session_hosts"
            ADD CONSTRAINT "session_hosts_session_id_foreign" FOREIGN key ("session_id") REFERENCES "session" ("id") ON UPDATE CASCADE ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "session_hosts"
            ADD CONSTRAINT "session_hosts_host_id_foreign" FOREIGN key ("host_id") REFERENCES "host" ("id") ON UPDATE CASCADE ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "response"
            ADD CONSTRAINT "response_custom_field_id_foreign" FOREIGN key ("custom_field_id") REFERENCES "custom_field" ("id") ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "response"
            ADD CONSTRAINT "response_host_id_foreign" FOREIGN key ("host_id") REFERENCES "host" ("id") ON DELETE CASCADE;
        `);
        this.addSql(`
            ALTER TABLE "response"
            ADD CONSTRAINT "response_session_id_foreign" FOREIGN key ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "host_availability"
            ADD CONSTRAINT "host_availability_host_id_foreign" FOREIGN key ("host_id") REFERENCES "host" ("id") ON DELETE CASCADE;
        `);
    }
}
