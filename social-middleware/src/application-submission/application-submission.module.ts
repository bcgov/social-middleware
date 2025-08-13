import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationSubmission } from './schemas/application-submission.schema';
import { ApplicationSubmissionController } from './application-submission.controller';
import { ApplicationSubmissionService } from './application-submission.service';
import { ApplicationModule } from '../application/application.module';
import { ApplicationSubmissionSchema } from './schemas/application-submission.schema';

// application-submission.module.ts
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApplicationSubmission.name, schema: ApplicationSubmissionSchema },
    ]),
    forwardRef(() => ApplicationModule), // Import to access ApplicationService
  ],
  controllers: [ApplicationSubmissionController],
  providers: [ApplicationSubmissionService],
  exports: [ApplicationSubmissionService],
})
export class ApplicationSubmissionModule {}
