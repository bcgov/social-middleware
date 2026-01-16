import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { Router } from 'express';

@Injectable()
export class BullDashboardService {
  private serverAdapter: ExpressAdapter;

  constructor(
    @InjectQueue('applicationPackageQueue')
    private readonly applicationPackageQueue: Queue,
  ) {
    // Set up the Express server adapter
    this.serverAdapter = new ExpressAdapter();
    this.serverAdapter.setBasePath('/admin/queues'); // Optional: Set base route

    // Create BullBoard dashboard with adapter
    createBullBoard({
      queues: [new BullAdapter(this.applicationPackageQueue)],
      serverAdapter: this.serverAdapter,
    });
  }

  getRouter(): Router {
    return this.serverAdapter.getRouter() as Router;
  }
}
