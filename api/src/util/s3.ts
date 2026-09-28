import { S3 } from "@aws-sdk/client-s3";
import { appConfig } from "./app-config.js";

export const s3Client = new S3({
    ...appConfig.s3.client,
    requestHandler: appConfig.s3.requestHandler,
});
