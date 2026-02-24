export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp';
export type ScannedStatus = 'pending' | 'clean' | 'infected' | 'error';

export interface Photo {
  readonly photo_id: string;
  readonly conversation_id: string;
  readonly work_order_id?: string | null;
  readonly filename: string;
  readonly content_type: PhotoContentType;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly storage_key: string;
  readonly scanned_status: ScannedStatus;
  readonly uploaded_by: string;
  readonly created_at: string;
}
