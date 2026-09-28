import { pathParams } from "@taxum/core/extract";
import { ExtensionKey, type HttpRequest, type HttpResponse } from "@taxum/core/http";
import { fromFn } from "@taxum/core/middleware/from-fn";
import type { HttpService } from "@taxum/core/service";
import { z } from "zod";
import { Edition } from "../../entity/Edition.js";
import { assertExists } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";

export const EDITION = new ExtensionKey<Edition>("Edition");

const editionIdExtractor = pathParams(z.object({ editionId: z.uuid() }));

export const resolveEditionLayer = fromFn(
    async (req: HttpRequest, next: HttpService): Promise<HttpResponse> => {
        const { editionId } = await editionIdExtractor(req);
        const edition = await em.findOne(Edition, editionId);
        assertExists(edition, "Edition", editionId);

        req.extensions.insert(EDITION, edition);
        return next.invoke(req);
    },
);
