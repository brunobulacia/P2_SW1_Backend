import { Module } from '@nestjs/common';
import { DiagramSocketService } from './diagram-socket.service';
import { DiagramSocketGateway } from './diagram-socket.gateway';
import { DiagramInvitesModule } from 'src/diagram_invites/diagram_invites.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { DiagramsModule } from 'src/diagrams/diagrams.module';

@Module({
  imports: [
    PrismaModule,
    DiagramInvitesModule,
    DiagramsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET, // usa un valor seguro en producción
      signOptions: { expiresIn: '1h' },
    }),
  ],
  providers: [DiagramSocketGateway, DiagramSocketService],
})
export class DiagramSocketModule {}
