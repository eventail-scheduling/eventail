import { describe, expect, it } from "vitest";
import type { LocationDetail } from "#/queries/location.ts";
import type { Venue } from "#/queries/venue.ts";
import { createLocationDefaultValues } from "#/routes/_user/manage/$editionId/locations/-components/LocationFormFields.tsx";

const venueNamed = (id: string, name: string): Venue => ({
    id,
    name,
    address: null,
    externalKey: null,
});

const congress = venueNamed("venue-congress", "Congress Center");
const annex = venueNamed("venue-annex", "Riverside Annex");

const locationIn = (venueId: string): LocationDetail => ({
    id: "location-1",
    name: "Side Room",
    externalKey: "side-room",
    venue: { id: venueId },
    availabilities: [],
});

describe("seeding the venue a location form opens on", () => {
    it("resolves the stored linkage to the venue the picker offers", () => {
        const values = createLocationDefaultValues({
            location: locationIn("venue-annex"),
            venues: [congress, annex],
        });

        expect(values.venue).toEqual(annex);
    });

    it("fills in the only venue when creating against one", () => {
        const values = createLocationDefaultValues({ location: null, venues: [congress] });

        expect(values.venue).toEqual(congress);
    });

    it("leaves the field empty when creating against several", () => {
        const values = createLocationDefaultValues({ location: null, venues: [congress, annex] });

        expect(values.venue).toBeUndefined();
    });
});
