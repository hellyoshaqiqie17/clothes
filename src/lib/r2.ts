import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 object storage (S3-compatible) for binary assets such as uploaded
 * garment photos. The D1 database only stores the resulting URL.
 */
export const R2_BUCKET = process.env.R2_BUCKET || "clothes";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Cloudflare R2 is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY."
    );
  }
  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

export async function getObject(
  key: string
): Promise<{ body: Uint8Array; contentType: string } | null> {
  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    if (!res.Body) return null;
    return {
      body: await res.Body.transformToByteArray(),
      contentType: res.ContentType || "application/octet-stream",
    };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}
