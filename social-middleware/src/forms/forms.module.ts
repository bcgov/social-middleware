import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { ApplicationModule } from 'src/application/application.module';

@Module({
  imports: [ApplicationModule],
  controllers: [FormsController],
  providers: [FormsService],
})
export class FormsModule {}
