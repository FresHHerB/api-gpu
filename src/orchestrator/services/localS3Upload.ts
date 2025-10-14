import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../../shared/utils/logger';

// ============================================
// Local S3/MinIO Upload Service (VPS Internal)
// Uses S3_LOCAL_URL for internal MinIO access
// ============================================

export class LocalS3UploadService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor() {
    const localEndpoint = process.env.S3_LOCAL_URL;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    const region = process.env.S3_REGION || 'us-east-1';

    this.bucketName = process.env.S3_BUCKET_NAME || 'canais';

    if (!localEndpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('Local S3 configuration missing: S3_LOCAL_URL, S3_ACCESS_KEY, or S3_SECRET_KEY');
    }

    // Configure S3 client for local MinIO access
    this.s3Client = new S3Client({
      endpoint: localEndpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      forcePathStyle: true, // Required for MinIO
      requestHandler: {
        requestTimeout: 60000, // 60s timeout for local operations
        httpsAgent: {
          maxSockets: 100
        }
      }
    });

    logger.info('[LocalS3UploadService] Initialized', {
      bucket: this.bucketName,
      endpoint: localEndpoint
    });
  }

  /**
   * Upload file from local disk to MinIO
   * @param path S3 path (e.g., "Channel/Video/videos/temp/")
   * @param filename File name (e.g., "video.mp4")
   * @param content File content as Buffer
   * @param contentType MIME type
   * @returns Public URL of uploaded file
   */
  async uploadFile(
    path: string,
    filename: string,
    content: Buffer,
    contentType: string = 'video/mp4'
  ): Promise<string> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Ensure path ends with /
        const normalizedPath = path.endsWith('/') ? path : `${path}/`;
        const key = `${normalizedPath}${filename}`;

        if (attempt > 1) {
          logger.warn('[LocalS3UploadService] Retry upload', {
            attempt,
            maxRetries,
            key
          });
        }

        logger.info('[LocalS3UploadService] Uploading to local MinIO', {
          bucket: this.bucketName,
          key,
          size: content.length
        });

        const command = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: content,
          ContentType: contentType,
          ACL: 'public-read',
          CacheControl: 'max-age=31536000' // 1 year cache
        });

        await this.s3Client.send(command);

        // Construct public URL using external endpoint
        const publicEndpoint = process.env.S3_ENDPOINT_URL!;
        const publicUrl = `${publicEndpoint}/${this.bucketName}/${key}`;

        logger.info('[LocalS3UploadService] Upload successful', {
          publicUrl,
          size: content.length
        });

        return publicUrl;

      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;

        logger.error('[LocalS3UploadService] Upload failed', {
          attempt,
          maxRetries,
          error: error.message
        });

        if (!isLastAttempt) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        throw new Error(`Local S3 upload failed after ${maxRetries} attempts: ${error.message}`);
      }
    }

    throw new Error('Local S3 upload failed: max retries exceeded');
  }

  /**
   * Upload multiple files in parallel
   */
  async uploadFiles(
    uploads: Array<{
      path: string;
      filename: string;
      content: Buffer;
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

    // Convert array to object
    const urlMap: Record<string, string> = {};
    results.forEach(result => {
      urlMap[result.filename] = result.url;
    });

    return urlMap;
  }
}
