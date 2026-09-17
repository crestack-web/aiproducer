/**
 * Apply R2 browser CORS for AP Studio beat/vocal presigned uploads.
 *
 * Usage (from repo root, with R2_* env loaded):
 *   node scripts/apply-r2-cors.mjs
 *
 * Or via deployed API:
 *   curl -X POST https://www.apstudio.site/api/admin/r2-cors \
 *     -H "Authorization: Bearer $R2_CORS_APPLY_TOKEN"
 */
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const endpoint =
  process.env.R2_ENDPOINT?.trim()?.replace(/\/$/, "") ||
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
const bucket = process.env.R2_BUCKET_NAME?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2_ENDPOINT/R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY");
  process.exit(1);
}

const origins = [
  "https://apstudio.site",
  "https://www.apstudio.site",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.R2_CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
];
const unique = [...new Set(origins)];

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: unique,
          AllowedMethods: ["GET", "PUT", "HEAD", "POST"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag", "Content-Length", "Content-Type", "x-amz-request-id"],
          MaxAgeSeconds: 86400,
        },
      ],
    },
  })
);

const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log("R2 CORS applied for", unique);
console.log(JSON.stringify(current.CORSRules, null, 2));
