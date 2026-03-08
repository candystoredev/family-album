import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _s3: S3Client | null = null;

export function getR2(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _s3;
}

export const BUCKET = () => process.env.R2_BUCKET_NAME!;
export const PUBLIC_URL = () => process.env.R2_PUBLIC_URL!.replace(/\/+$/, "");

/** Upload a buffer to R2 and return the public URL */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  await getR2().send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_URL()}/${key}`;
}

/** Generate a presigned PUT URL for direct client upload */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getR2(), command, { expiresIn });
}

/** Download an object from R2 */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const response = await getR2().send(
    new GetObjectCommand({
      Bucket: BUCKET(),
      Key: key,
    })
  );
  const bytes = await response.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Delete an object from R2 */
export async function deleteFromR2(key: string): Promise<void> {
  await getR2().send(
    new DeleteObjectCommand({
      Bucket: BUCKET(),
      Key: key,
    })
  );
}
