import type { RegressionCandidate } from './mine-regressions.js';

export type ReviewStatus = 'pending_review' | 'approved' | 'rejected';

export interface ReviewedCandidate {
  readonly candidate: RegressionCandidate;
  readonly status: ReviewStatus;
  readonly reviewer?: string;
  readonly review_notes?: string;
  readonly reviewed_at?: string;
}

export class ReviewQueue {
  private items: ReviewedCandidate[] = [];

  add(candidate: RegressionCandidate): void {
    this.items.push({ candidate, status: 'pending_review' });
  }

  addAll(candidates: readonly RegressionCandidate[]): void {
    for (const c of candidates) this.add(c);
  }

  review(index: number, status: 'approved' | 'rejected', reviewer: string, notes?: string): void {
    if (index < 0 || index >= this.items.length) throw new Error(`Invalid index: ${index}`);
    this.items[index] = {
      ...this.items[index],
      status,
      reviewer,
      review_notes: notes,
      reviewed_at: new Date().toISOString(),
    };
  }

  getPending(): readonly ReviewedCandidate[] {
    return this.items.filter((i) => i.status === 'pending_review');
  }

  getApproved(): readonly ReviewedCandidate[] {
    return this.items.filter((i) => i.status === 'approved');
  }

  getAll(): readonly ReviewedCandidate[] {
    return [...this.items];
  }
}
