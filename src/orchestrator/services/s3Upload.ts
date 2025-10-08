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

    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      forcePathStyle: true // Required for MinIO
    });

    console.log(`[S3UploadService] Initialized with bucket: ${this.bucketName}`);
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
    try {
      // Ensure path ends with /
      const normalizedPath = path.endsWith('/') ? path : `${path}/`;
      const key = `${normalizedPath}${filename}`;

      console.log(`[S3UploadService] Uploading to: ${this.bucketName}/${key}`);

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: content,
        ContentType: contentType,
        ACL: 'public-read' // Make file publicly accessible
      });

      await this.s3Client.send(command);

      // Construct public URL
      const endpoint = process.env.S3_ENDPOINT_URL!;
      const publicUrl = `${endpoint}/${this.bucketName}/${key}`;

      console.log(`[S3UploadService] Upload successful: ${publicUrl}`);

      return publicUrl;
    } catch (error) {
      console.error(`[S3UploadService] Upload failed:`, error);
      throw new Error(`S3 upload failed: ${error}`);
    }
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
