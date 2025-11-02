// src/diagram_socket/diagram-socket.gateway.ts
import OpenAI from 'openai';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { DiagramSocketService } from './diagram-socket.service';
import { DiagramInvitesService } from 'src/diagram_invites/diagram_invites.service';
import { JwtService } from '@nestjs/jwt';
import { CreateDiagramInviteDto } from 'src/diagram_invites/dto/create-diagram_invite.dto';
import { DiagramsService } from 'src/diagrams/diagrams.service';

const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3000', 'http://54.207.207.246:3000'],
    credentials: true,
  },
  namespace: '/',
})
export class DiagramSocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() wss: Server;

  constructor(
    private readonly diagramSocketService: DiagramSocketService,
    private readonly diagramInvitesService: DiagramInvitesService,
    private readonly diagramService: DiagramsService,
    private readonly token: JwtService,
  ) {}

  handleConnection(client: Socket) {
    this.diagramSocketService.addClient(client);
    this.wss.emit('message', {
      conexiones: this.diagramSocketService.getClientCount(),
    });
  }

  handleDisconnect(client: Socket) {
    console.log(`🔌 Cliente desconectado: ${client.id}`);

    // Obtener todas las rooms donde estaba este cliente
    const allRooms = this.diagramSocketService.getAllDiagramRooms();

    // Remover el cliente de todas las rooms y notificar a los participantes restantes
    allRooms.forEach((diagramId) => {
      const participants =
        this.diagramSocketService.removeParticipantFromDiagram(
          diagramId,
          client,
        );
      console.log(
        `👥 Participantes restantes en diagrama ${diagramId}:`,
        participants.length,
      );

      // Notificar a los participantes restantes en esta room
      const room = `diagram:${diagramId}`;
      this.wss.to(room).emit('participants-updated', { participants });
    });

    // Remover el cliente del tracking general
    this.diagramSocketService.removeClient(client);

    this.wss.emit('message', {
      conexiones: this.diagramSocketService.getClientCount(),
    });
  }

  @SubscribeMessage('join-diagram')
  handleJoinDiagram(
    @MessageBody() data: { diagramId: string | number },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `diagram:${data.diagramId}`;
    client.join(room);

    // Agregar participante al tracking
    const participants = this.diagramSocketService.addParticipantToDiagram(
      String(data.diagramId),
      client,
    );

    // Notificar a todos en la room sobre los participantes actualizados
    client.to(room).emit('participants-updated', { participants });

    // Enviar lista actual de participantes al nuevo participante
    client.emit('participants-updated', { participants });
    client.emit('joined-diagram', { diagramId: data.diagramId });
  }

  @SubscribeMessage('leave-diagram')
  handleLeaveDiagram(
    @MessageBody() data: { diagramId: string | number },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `diagram:${data.diagramId}`;
    client.leave(room);

    // Remover participante del tracking
    const participants = this.diagramSocketService.removeParticipantFromDiagram(
      String(data.diagramId),
      client,
    );

    // Notificar a los participantes restantes
    client.to(room).emit('participants-updated', { participants });
  }

  @SubscribeMessage('get-participants')
  handleGetParticipants(
    @MessageBody() data: { diagramId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const participants = this.diagramSocketService.getDiagramParticipants(
      data.diagramId,
    );
    client.emit('participants-updated', { participants });
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @MessageBody() data: { diagramId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Actualizar timestamp del participante para mantenerlo activo
    const participants = this.diagramSocketService.getDiagramParticipants(
      data.diagramId,
    );
    const participant = participants.find((p) => p.socketId === client.id);

    if (participant) {
      participant.joinedAt = new Date();
      console.log(
        `💓 Heartbeat recibido de ${client.id} en diagrama ${data.diagramId}`,
      );
    }
  }

  @SubscribeMessage('generate-invite')
  async handleGenerateInvite(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const token = this.token.sign(data);
    data.token = token;
    data as CreateDiagramInviteDto;
    const invite = await this.diagramInvitesService.create(data);
    client.emit('invite-created', invite);
  }

  /**
   * Espera: { id, model: { nodes, edges, ... } }
   * Filtra el payload para no pasar campos desconocidos a Prisma (p.ej., sourceId).
   */
  @SubscribeMessage('update-diagram')
  async handleUpdateDiagram(
    @MessageBody()
    data: {
      id: string;
      model: any; // { nodes, edges, metadata? }
      // NO sourceId
    },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const { id, model } = data || ({} as any);
    if (!id || !model) {
      client.emit('diagram-updated:ack', {
        id,
        ok: false,
        reason: 'invalid-payload',
      });
      return;
    }

    // 👉 Solo pasamos campos válidos al service/Prisma
    const updatedDiagram = await this.diagramService.update(id, {
      model,
    } as any);

    const room = `diagram:${id}`;

    // Broadcast a todos EXCEPTO el emisor, dentro de la misma room
    client.to(room).emit('diagram-updated', {
      id: updatedDiagram.id,
      model: updatedDiagram.model,
      // sin sourceId
    });

    // ACK al emisor (sin el modelo completo para ahorrar ancho de banda)
    client.emit('diagram-updated:ack', { id, ok: true });
  }

  @SubscribeMessage('generate-agent')
  async handleGenerateAgent(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a coding assistant that generates diagrams.',
          },
          {
            role: 'user',
            content: data.prompt || 'Are semicolons optional in JavaScript?',
          },
        ],
      });

      const responseText =
        completion.choices[0]?.message?.content || 'No response generated';
      console.log(responseText);
      client.emit('agent-generated', { text: responseText });
    } catch (error) {
      console.error('Error generating agent response:', error);
      client.emit('agent-generated', {
        text: 'Error generating response',
        error: error.message,
      });
    }
  }

  @SubscribeMessage('generate-diagram')
  async handleGenerateDiagram(
    @MessageBody()
    data: {
      prompt: string;
      diagramId: string;
      currentDiagram?: { nodes: any[]; edges: any[] };
    },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      // Obtener el diagrama actual de la base de datos si no se envió
      let currentDiagram = data.currentDiagram;
      if (!currentDiagram) {
        const diagram = await this.diagramService.findOne(data.diagramId);
        currentDiagram = (diagram as any).model || { nodes: [], edges: [] };
      }

      const hasExistingDiagram =
        currentDiagram?.nodes && currentDiagram.nodes.length > 0;

      const systemPrompt = `
Eres un experto en UML y diseño de diagramas de clases. Tu tarea es ${hasExistingDiagram ? 'MODIFICAR Y EXTENDER' : 'generar'} un diagrama UML en formato JSON basado en la descripción del usuario.

${
  hasExistingDiagram
    ? `
⚠️ INSTRUCCIONES CRÍTICAS PARA MODIFICACIÓN:
1. DEBES PRESERVAR TODAS las clases existentes del diagrama actual
2. DEBES PRESERVAR TODAS las relaciones (edges) existentes
3. SOLO AGREGA las nuevas clases solicitadas por el usuario
4. SOLO AGREGA nuevas relaciones si el usuario las menciona explícitamente
5. NO ELIMINES ni modifiques clases o relaciones existentes
6. Las nuevas clases deben tener IDs únicos diferentes a los existentes
7. Posiciona las nuevas clases en áreas libres del canvas (evita solapamiento)

DIAGRAMA ACTUAL QUE DEBES PRESERVAR:
${JSON.stringify(currentDiagram, null, 2)}

Tu respuesta DEBE incluir:
- TODOS los nodos existentes (sin modificar)
- TODOS los edges existentes (sin modificar)  
- Los nuevos nodos solicitados
- Nuevos edges solo si son necesarios
`
    : ''
}

Tu tarea es ${hasExistingDiagram ? 'AGREGAR al diagrama existente' : 'generar un diagrama nuevo'} siguiendo este formato.

Formato esperado del JSON:
{
  "edges": [
    {
      "id": "edge-[sourceId]-[targetId]-[type]-[timestamp]",
      "data": {
        "type": "inheritance|association|aggregation|composition|realization|dependency",
        "label": "etiqueta de la relación",
        "sourceCardinality": "cardinalidad del origen (ej: 1..1, 1..*, 0..1)",
        "targetCardinality": "cardinalidad del destino"
      },
      "type": "inheritance|association|aggregation|composition|realization|dependency",
      "source": "node-[timestamp]",
      "target": "node-[timestamp]",
      "sourceHandle": "bottom|top|left|right|bottom-left|bottom-right|top-left|top-right",
      "targetHandle": "bottom|top|left|right|bottom-left|bottom-right|top-left|top-right"
    }
  ],
  "nodes": [
    {
      "id": "node-[timestamp]",
      "data": {
        "label": "NombreClase",
        "methods": [],
        "attributes": [
          {
            "id": "attr-[timestamp]",
            "name": "nombreAtributo",
            "type": "int|string|boolean|double|float|Date|etc",
            "visibility": "public|private|protected"
          }
        ],
        "isAssociationClass": false
      },
      "type": "textUpdater",
      "position": {
        "x": 100 + (index * 300),
        "y": 100 + (index * 200)
      }
    }
  ],
  "metadata": {
    "version": "1.0",
    "lastModified": "fecha actual"
  }
}

EJEMPLO de relación muchos-a-muchos (Usuario-Producto):
{
  "nodes": [
    {
      "id": "node-1234567890",
      "data": {
        "label": "Usuario",
        "methods": [],
        "attributes": [{"id": "attr-1", "name": "id", "type": "int", "visibility": "private"}, {"id": "attr-2", "name": "nombre", "type": "string", "visibility": "public"}],
        "isAssociationClass": false
      },
      "type": "textUpdater",
      "position": {"x": 100, "y": 100}
    },
    {
      "id": "node-1234567891", 
      "data": {
        "label": "Producto",
        "methods": [],
        "attributes": [{"id": "attr-3", "name": "id", "type": "int", "visibility": "private"}, {"id": "attr-4", "name": "nombre", "type": "string", "visibility": "public"}],
        "isAssociationClass": false
      },
      "type": "textUpdater",
      "position": {"x": 500, "y": 100}
    },
    {
      "id": "association-1234567892",
      "data": {
        "label": "Compra",
        "methods": [],
        "attributes": [{"id": "attr-5", "name": "cantidad", "type": "int", "visibility": "private"}, {"id": "attr-6", "name": "fecha", "type": "Date", "visibility": "private"}],
        "isAssociationClass": true
      },
      "type": "textUpdater",
      "position": {"x": 300, "y": 300}
    }
  ],
  "edges": [
    {
      "id": "edge-1234567890-1234567891-association-1234567893",
      "type": "association",
      "source": "node-1234567890",
      "target": "node-1234567891",
      "sourceHandle": "bottom",
      "targetHandle": "bottom",
      "data": {
        "type": "association",
        "sourceCardinality": "*",
        "targetCardinality": "*",
        "label": "compra",
        "associationClass": "association-1234567892"
      }
    }
  ]
}

Reglas importantes:
${
  hasExistingDiagram
    ? `
🚨 REGLAS CRÍTICAS PARA MODIFICACIÓN (OBLIGATORIO):
1. NO CREAR UN DIAGRAMA NUEVO - Debes MODIFICAR el diagrama existente
2. COPIA EXACTAMENTE todos los nodos existentes (mismo id, data, position)
3. COPIA EXACTAMENTE todos los edges existentes (mismo id, source, target, data)
4. SOLO AGREGA las nuevas clases que el usuario solicita
5. Genera IDs únicos para las nuevas clases usando timestamps únicos
6. Posiciona las nuevas clases en ubicaciones libres (x > 800 o y > 600)
7. SOLO crea nuevas relaciones si el usuario las menciona explícitamente
8. NO modifiques ni elimines nada del diagrama existente
9. Responde con el JSON completo: nodos existentes + nodos nuevos + edges existentes + edges nuevos (si aplica)
`
    : `
1. Genera IDs únicos usando timestamps
2. SIEMPRE incluye relaciones entre las clases (edges) si hay múltiples clases
3. Para herencia, usa type: "inheritance" y sourceHandle/targetHandle apropiados
4. Para asociaciones, usa type: "association" con cardinalidades apropiadas (ej: "1..1", "1..*", "0..1")
5. Posiciona las clases de manera que no se solapen
`
}
6. Usa tipos de datos apropiados (int, string, boolean, etc.)
7. Incluye SOLO atributos relevantes para cada clase, NO incluyas métodos
8. Siempre deja el array "methods" vacío: "methods": []
9. Si hay múltiples clases, crea relaciones lógicas entre ellas (asociaciones, herencia, etc.)
10. Responde ÚNICAMENTE con el JSON válido, SIN markdown, SIN explicaciones, SOLO el objeto JSON puro

IMPORTANTE: Si el usuario menciona múltiples clases, DEBES crear relaciones entre ellas. Ejemplos:
- Usuario y Producto: relación muchos-a-muchos con clase de asociación intermedia
- Si hay clases similares: crear herencia cuando sea apropiado
- Si hay jerarquías: crear herencia (ej: Vehiculo -> Auto, Camion)

Para relaciones muchos-a-muchos (como Usuario-Producto), crear:
1. Una clase de asociación intermedia (ej: "Compra" o "Pedido")
2. Una relación principal entre las clases con:
   - type: "association"
   - sourceCardinality: "*"
   - targetCardinality: "*"
   - associationClass: [id-de-la-clase-intermedia]
3. La clase intermedia debe tener isAssociationClass: true

OBLIGATORIO: Siempre incluye al menos una relación si hay más de una clase. NUNCA dejes el diagrama sin edges.

IMPORTANTE: Responde SOLO con el JSON del diagrama, SIN explicaciones, SIN markdown, SOLO el objeto JSON puro.

IMPORTANTE: Si el usuario te pide aumentar algo al JSON del diagrama, no se debe crear otro diagrama desde cero, sino aumentar el diagrama existente con las nuevas clases/relaciones solicitadas.

`;

      // Usar OpenAI con reintentos
      let completion;
      let lastError;

      const models = ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];

      for (const model of models) {
        try {
          console.log(`🤖 Intentando con modelo OpenAI: ${model}`);

          const userMessage = hasExistingDiagram
            ? `🚨 IMPORTANTE: Ya existe un diagrama con ${currentDiagram?.nodes?.length || 0} clases y ${currentDiagram?.edges?.length || 0} relaciones. 
            
NO CREES UN DIAGRAMA NUEVO. Debes:
1. COPIAR todos los nodos existentes tal cual están
2. COPIAR todos los edges existentes tal cual están  
3. AGREGAR las nuevas clases solicitadas: ${data.prompt}

EJEMPLO DE RESPUESTA ESPERADA:
{
  "nodes": [
    ...todos los nodos existentes copiados exactamente...,
    ...nuevos nodos solicitados...
  ],
  "edges": [
    ...todos los edges existentes copiados exactamente...,
    ...nuevos edges solo si se solicitan...
  ]
}

Solicitud del usuario: ${data.prompt}`
            : `Genera un diagrama UML basado en: ${data.prompt}`;

          completion = await openai.chat.completions.create({
            model: model,
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              {
                role: 'user',
                content: userMessage,
              },
            ],
            temperature: 0.3, // Temperatura más baja para ser más consistente
            response_format: { type: 'json_object' },
          });
          console.log(`✅ Éxito con modelo OpenAI: ${model}`);
          break; // Si funciona, salir del loop
        } catch (error) {
          console.log(`❌ Error con modelo ${model}:`, error.message);
          lastError = error;

          // Si es error de rate limit o sobrecarga, esperar y continuar con el siguiente modelo
          if (error.status === 429 || error.status === 503) {
            console.log(
              `⏳ Modelo ${model} sobrecargado, probando siguiente...`,
            );
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Esperar 2 segundos
            continue;
          }

          // Si no es 429/503, lanzar el error inmediatamente
          throw error;
        }
      }

      // Si llegamos aquí y no hay completion, todos los modelos fallaron
      if (!completion) {
        throw lastError || new Error('Todos los modelos de OpenAI fallaron');
      }

      // Obtener la respuesta del modelo
      const responseText = completion.choices[0]?.message?.content || '{}';

      // Limpiar la respuesta de cualquier markdown (por si acaso)
      let cleanText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      console.log('🤖 Raw OpenAI response:', responseText);
      console.log('🧹 Cleaned text:', cleanText);

      const diagramJson = JSON.parse(cleanText);
      console.log(
        '📊 Parsed diagram JSON:',
        JSON.stringify(diagramJson, null, 2),
      );

      // Actualizar el diagrama en la base de datos
      const updatedDiagram = await this.diagramService.update(data.diagramId, {
        model: diagramJson,
      });

      // Emitir la respuesta al cliente
      client.emit('diagram-generated', {
        success: true,
        diagram: diagramJson,
        message: 'Diagrama generado exitosamente con OpenAI',
      });

      // Broadcast a todos los clientes en la room del diagrama
      const room = `diagram:${data.diagramId}`;
      client.to(room).emit('diagram-updated', {
        id: updatedDiagram.id,
        model: updatedDiagram.model,
      });
    } catch (error) {
      console.error('Error generating diagram:', error);
      client.emit('diagram-generated', {
        success: false,
        error:
          'Error al generar el diagrama. Por favor, intenta con una descripción más específica.',
        message: error.message,
      });
    }
  }
}
