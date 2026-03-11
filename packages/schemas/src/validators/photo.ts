import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { Photo } from '../types/photo.js';

const PHOTO_REF = 'photo.schema.json#/definitions/Photo';

export function validatePhoto(data: unknown): ValidationResult<Photo> {
  return validate<Photo>(data, PHOTO_REF);
}
