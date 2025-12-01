export enum SubmissionStatus {
  PENDING = 'pending', // Not yet submitted or queued
  SUCCESS = 'success', // Successfully submitted to Siebel
  ERROR = 'error', // Temporary error, will retry
  FAILED = 'failed', // Exhausted all retries, manual intervention needed
}
