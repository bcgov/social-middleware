export enum AttachmentType {
  _ = '_',
  ABOUTSPOUSE = 'About Me (Spouse)',
  CONSENT = 'Consent',
  CRIMINAL_RECORD_CHECK = 'Criminal Record Check',
  DISCLOSURECONSENT = 'Consent for Disclosure of Criminal Record Information',
  MEDICAL_ASSESSMENT = 'Medical Assessment',
  IDENTIFICATION = 'Identification',
  INTERNATIONAL_RECORD = 'International Criminal Record Check',
  OTHER = 'Other Document',
  PCCCONSENT = 'Consent for Prior Contact Check',
  PROOF_OF_RESIDENCE = 'Proof of Residence',
  REFERENCE_LETTER = 'Reference Letter',
  TRAINING_CERTIFICATE = 'Training Certificate',
}

// meta data for attachments in ICM
export const AttachmentCategoryMap: Partial<Record<AttachmentType, string>> = {
  [AttachmentType.MEDICAL_ASSESSMENT]: 'Medical',
  [AttachmentType.INTERNATIONAL_RECORD]: 'Documentation',
  [AttachmentType.DISCLOSURECONSENT]: 'Consent',
  [AttachmentType.PCCCONSENT]: 'Consent',
  [AttachmentType.ABOUTSPOUSE]: 'Application & Request',
  [AttachmentType.OTHER]: 'Other Assessment',
  [AttachmentType.TRAINING_CERTIFICATE]: 'Training',
};

export enum AllowedFileType {
  PDF = 'pdf',
  JPG = 'jpg',
  JPEG = 'jpeg',
  PNG = 'png',
}
