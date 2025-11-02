import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';

interface ConnectedClients {
  [clientId: string]: Socket;
}

interface DiagramParticipant {
  socketId: string;
  userId?: string;
  username?: string;
  joinedAt: Date;
}

interface DiagramRooms {
  [diagramId: string]: DiagramParticipant[];
}

@Injectable()
export class DiagramSocketService {
  private connectedClients: ConnectedClients = {};
  private diagramRooms: DiagramRooms = {};

  addClient(client: Socket) {
    this.connectedClients[client.id] = client;
  }

  removeClient(client: Socket) {
    delete this.connectedClients[client.id];

    // Remover de todas las rooms
    Object.keys(this.diagramRooms).forEach((diagramId) => {
      this.diagramRooms[diagramId] = this.diagramRooms[diagramId].filter(
        (participant) => participant.socketId !== client.id,
      );

      // Si no hay más participantes, limpiar la room
      if (this.diagramRooms[diagramId].length === 0) {
        delete this.diagramRooms[diagramId];
      }
    });
  }

  getClients() {
    return Object.values(this.connectedClients);
  }

  getClientCount() {
    return Object.keys(this.connectedClients).length;
  }

  // Nuevos métodos para manejar participantes de diagramas
  addParticipantToDiagram(
    diagramId: string,
    client: Socket,
    userInfo?: { userId?: string; username?: string },
  ) {
    if (!this.diagramRooms[diagramId]) {
      this.diagramRooms[diagramId] = [];
    }

    const participant: DiagramParticipant = {
      socketId: client.id,
      userId: userInfo?.userId,
      username: userInfo?.username || `Usuario ${client.id.slice(0, 6)}`,
      joinedAt: new Date(),
    };

    // Verificar si ya existe
    const existingIndex = this.diagramRooms[diagramId].findIndex(
      (p) => p.socketId === client.id,
    );

    if (existingIndex >= 0) {
      this.diagramRooms[diagramId][existingIndex] = participant;
    } else {
      this.diagramRooms[diagramId].push(participant);
    }

    return this.diagramRooms[diagramId];
  }

  removeParticipantFromDiagram(diagramId: string, client: Socket) {
    if (!this.diagramRooms[diagramId]) return [];

    this.diagramRooms[diagramId] = this.diagramRooms[diagramId].filter(
      (participant) => participant.socketId !== client.id,
    );

    if (this.diagramRooms[diagramId].length === 0) {
      delete this.diagramRooms[diagramId];
      return [];
    }

    return this.diagramRooms[diagramId];
  }

  getDiagramParticipants(diagramId: string): DiagramParticipant[] {
    return this.diagramRooms[diagramId] || [];
  }

  getDiagramParticipantCount(diagramId: string): number {
    return this.diagramRooms[diagramId]?.length || 0;
  }

  getAllDiagramRooms(): string[] {
    return Object.keys(this.diagramRooms);
  }
}
