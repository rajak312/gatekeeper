import { Global, Module } from '@nestjs/common';
import { JwtService } from './jwt.service';
import { KeysService } from './keys.service';

@Global()
@Module({ providers: [KeysService, JwtService], exports: [KeysService, JwtService] })
export class KeysModule {}
