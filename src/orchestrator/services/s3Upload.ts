import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// ============================================
// S3/MinIO Upload Service
// Handles file uploads to S3-compatible storage
// ============================================

export class S3UploadService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT_URL;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    const region = process.env.S3_REGION || 'us-east-1';

    this.bucketName = process.env.S3_BUCKET_NAME || 'canais';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 configuration missing: S3_ENDPOINT_URL, S3_ACCESS_KEY, or S3_SECRET_KEY');
    }

    // Same configuration as worker Python (boto3)
    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      forcePathStyle: true, // Required for MinIO
      requestHandler: {
        requestTimeout: 30000, // 30s timeout
        httpsAgent: {
          maxSockets: 50
        }
      }
    });

    console.log(`[S3UploadService] Initialized with bucket: ${this.bucketName}, endpoint: ${endpoint}`);
  }

  /**
   * Upload file to S3/MinIO
   * @param path S3 path (e.g., "transcriptions/job-uuid/")
   * @param filename File name (e.g., "segments.srt")
   * @param content File content as string or Buffer
   * @param contentType MIME type (e.g., "text/plain")
   * @returns Public URL of uploaded file
   */
  async uploadFile(
    path: string,
    filename: string,
    content: string | Buffer,
    contentType: string = 'text/plain'
  ): Promise<string> {
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Ensure path ends with /
        const normalizedPath = path.endsWith('/') ? path : `${path}/`;
        const key = `${normalizedPath}${filename}`;

        if (attempt > 1) {
          console.log(`[S3UploadService] Retry ${attempt}/${maxRetries} for: ${this.bucketName}/${key}`);
        } else {
          console.log(`[S3UploadService] Uploading to: ${this.bucketName}/${key}`);
        }

        const command = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: content,
          ContentType: contentType,
          ACL: 'public-read', // Same as worker Python
          CacheControl: 'max-age=31536000' // 1 year cache
        });

        await this.s3Client.send(command);

        // Construct public URL
        const endpoint = process.env.S3_ENDPOINT_URL!;
        const publicUrl = `${endpoint}/${this.bucketName}/${key}`;

        console.log(`[S3UploadService] Upload successful: ${publicUrl}`);

        return publicUrl;
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        const isDnsError = error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT';

        if (isDnsError && !isLastAttempt) {
          console.warn(`[S3UploadService] DNS/Network error on attempt ${attempt}/${maxRetries}, retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        console.error(`[S3UploadService] Upload failed on attempt ${attempt}/${maxRetries}:`, error);

        if (isLastAttempt) {
          throw new Error(`S3 upload failed after ${maxRetries} attempts: ${error.message || error}`);
        }
      }
    }

    throw new Error('S3 upload failed: max retries exceeded');
  }

  /**
   * Upload multiple files in parallel
   */
  async uploadFiles(
    uploads: Array<{
      path: string;
      filename: string;
      content: string | Buffer;
      contentType?: string;
    }>
  ): Promise<Record<string, string>> {
    const uploadPromises = uploads.map(async (upload) => ({
      filename: upload.filename,
      url: await this.uploadFile(
        upload.path,
        upload.filename,
        upload.content,
        upload.contentType
      )
    }));

    const results = await Promise.all(uploadPromises);

    // Convert array to object: { "segments.srt": "https://...", ... }
    const urlMap: Record<string, string> = {};
    results.forEach(result => {
      urlMap[result.filename] = result.url;
    });

    return urlMap;
  }
}
