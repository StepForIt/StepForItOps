import { Global, Module } from '@nestjs/common';
import { CheckProfilesController } from './check-profiles.controller';
import { CheckProfilesService } from './check-profiles.service';

/** Global : les modules d'analyse lisent la sélection de contrôles sans import croisé. */
@Global()
@Module({
  controllers: [CheckProfilesController],
  providers: [CheckProfilesService],
  exports: [CheckProfilesService],
})
export class CheckProfilesModule {}
