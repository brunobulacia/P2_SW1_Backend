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
      const room = `diagram:${diagramId}`;
      this.wss.to(room).emit('participants-updated', { participants });
    });
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
    const participants = this.diagramSocketService.addParticipantToDiagram(
      String(data.diagramId),
      client,
    );
    client.to(room).emit('participants-updated', { participants });
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
    const participants = this.diagramSocketService.removeParticipantFromDiagram(
      String(data.diagramId),
      client,
    );
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
    const participants = this.diagramSocketService.getDiagramParticipants(
      data.diagramId,
    );
    const participant = participants.find((p) => p.socketId === client.id);
    if (participant) {
      participant.joinedAt = new Date();
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
      model: any;
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

    const updatedDiagram = await this.diagramService.update(id, {
      model,
    } as any);
    const room = `diagram:${id}`;
    client.to(room).emit('diagram-updated', {
      id: updatedDiagram.id,
      model: updatedDiagram.model,
    });
    client.emit('diagram-updated:ack', { id, ok: true });
  }

  @SubscribeMessage('generate-agent')
  async handleGenerateAgent(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    console.log('🤖 GENERATE AGENT REQUEST:');
    console.log('Prompt:', data.prompt);

    // Detectar si la solicitud es para modificar un diagrama
    const prompt = (data.prompt || '').toLowerCase();
    console.log('🔍 Prompt normalizado:', prompt);
    const isDiagramModification =
      // Agregar elementos - más variaciones
      (prompt.includes('agregar') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('agrega') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('añadir') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('añade') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('incluir') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('incluye') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('crear') && prompt.includes('clase')) ||
      // Eliminar elementos - más variaciones
      (prompt.includes('eliminar') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('elimina') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('quitar') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('quita') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('remover') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('remueve') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('borrar') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      (prompt.includes('borra') &&
        (prompt.includes('atributo') || prompt.includes('clase'))) ||
      // Modificar elementos
      (prompt.includes('modificar') && prompt.includes('clase')) ||
      // Casos específicos
      (prompt.includes('semestre') && prompt.includes('aula'));

    // Debug: mostrar qué condiciones se cumplen
    console.log('🔍 Condiciones de detección:');
    console.log(
      '  - Contiene "elimina" + "atributo":',
      prompt.includes('elimina') && prompt.includes('atributo'),
    );
    console.log(
      '  - Contiene "agrega" + "atributo":',
      prompt.includes('agrega') && prompt.includes('atributo'),
    );
    console.log('  - Contiene "clase":', prompt.includes('clase'));
    console.log('  - isDiagramModification:', isDiagramModification);

    if (isDiagramModification) {
      console.log(
        '🎯 DETECTADA SOLICITUD DE MODIFICACIÓN DE DIAGRAMA - Redirigiendo...',
      );
      console.log('Data recibida:', data);

      // Obtener el diagramId de los datos o de las rooms del cliente
      let diagramId = data.diagramId;

      if (!diagramId) {
        // Intentar extraer el diagramId de las rooms donde está el cliente
        const rooms = Array.from(client.rooms);
        console.log('Rooms del cliente:', rooms);

        const diagramRoom = rooms.find((room) => room.startsWith('diagram:'));
        if (diagramRoom) {
          diagramId = diagramRoom.replace('diagram:', '');
          console.log('DiagramId extraído de room:', diagramId);
        }
      }

      if (!diagramId) {
        console.log('❌ No se pudo obtener diagramId');
        client.emit('agent-generated', {
          text: 'Error: No se pudo identificar el diagrama para modificar. Por favor, asegúrate de estar conectado a un diagrama.',
        });
        return;
      }

      const diagramData = {
        prompt: data.prompt,
        diagramId: diagramId,
        currentDiagram: data.currentDiagram,
      };

      console.log('🔄 Redirigiendo a handleGenerateDiagram con:', {
        diagramId,
        prompt: data.prompt,
      });

      // Llamar al método de generación de diagramas internamente
      return this.handleGenerateDiagram(diagramData, client);
    }

    console.log('⚠️ Solicitud de chat normal - NO modifica diagramas');

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
      console.log('🎯 GENERATE DIAGRAM REQUEST:');
      console.log('Prompt:', data.prompt);
      console.log('DiagramId:', data.diagramId);
      console.log('Has currentDiagram:', !!data.currentDiagram);

      // Obtener el diagrama actual de la base de datos si no se envió
      let currentDiagram = data.currentDiagram;
      if (!currentDiagram) {
        console.log('📋 Obteniendo diagrama de la base de datos...');
        const diagram = await this.diagramService.findOne(data.diagramId);
        currentDiagram = (diagram as any).model || { nodes: [], edges: [] };
        console.log('📊 Diagrama obtenido:', {
          nodes: currentDiagram?.nodes?.length || 0,
          edges: currentDiagram?.edges?.length || 0,
        });
      }

      const hasExistingDiagram =
        currentDiagram?.nodes && currentDiagram.nodes.length > 0;

      console.log('🔍 hasExistingDiagram:', hasExistingDiagram);
      if (hasExistingDiagram && currentDiagram) {
        console.log(
          '📝 Clases existentes:',
          currentDiagram.nodes.map((n) => n.data?.label).filter(Boolean),
        );
      }

      const systemPrompt = `
Eres un experto en UML y diseño de diagramas de clases. Tu tarea es ${hasExistingDiagram ? 'MODIFICAR Y EXTENDER' : 'generar'} un diagrama UML en formato JSON basado en la descripción del usuario.

${
  hasExistingDiagram
    ? `
⚠️ INSTRUCCIONES CRÍTICAS PARA MODIFICACIÓN:
1. PRESERVA todas las clases existentes del diagrama actual
2. PRESERVA todas las relaciones (edges) existentes
3. Si el usuario solicita AGREGAR atributos a una clase existente, MODIFICA esa clase específica agregando los nuevos atributos
4. Si el usuario solicita nuevas clases, agrégalas con IDs únicos
5. Si el usuario solicita nuevas relaciones, agrégalas apropiadamente
6. NO ELIMINES clases, atributos o relaciones existentes a menos que se solicite explícitamente
7. Posiciona las nuevas clases en áreas libres del canvas (evita solapamiento)
8. Mantén las posiciones existentes de las clases actuales

DIAGRAMA ACTUAL:
${JSON.stringify(currentDiagram, null, 2)}

EJEMPLO ESPECÍFICO - Agregar atributo "semestre" a clase "Aula":
Si el diagrama actual tiene una clase "Aula" con atributos [nombre, capacidad], y el usuario pide "agregar atributo semestre":
1. Busca el nodo con data.label = "Aula"
2. En su array "attributes", agrega: {"id": "attr-[timestamp]", "name": "semestre", "type": "String", "visibility": "private"}
3. Mantén EXACTAMENTE todo lo demás: id del nodo, position, otros atributos, etc.
4. Copia todos los demás nodos sin cambios
5. Copia todos los edges sin cambios

ANÁLISIS DEL PEDIDO:
- Si menciona "agregar atributo X a clase Y": modifica la clase Y agregando el atributo X
- Si menciona "eliminar/quitar/remover/borrar atributo X de clase Y": modifica la clase Y eliminando el atributo X
- Si menciona "crear clase nueva": agrega una nueva clase
- Si menciona "eliminar clase Y": elimina la clase Y del diagrama
- Si menciona "agregar relación": agrega una nueva relación

Tu respuesta DEBE incluir:
- TODOS los nodos existentes (modificados si se agregan/eliminan atributos a clases específicas)
- TODOS los edges existentes (sin modificar a menos que se solicite)  
- Los nuevos nodos solicitados (si aplica)
- Eliminar nodos o atributos SOLO si se solicita explícitamente
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
2. Para AGREGAR ATRIBUTOS a clase existente:
   - Copia la clase exactamente (mismo id, data.label, position, type)
   - Agrega el nuevo atributo al array "attributes" existente
   - Genera ID único para el nuevo atributo: "attr-[timestamp]"
   - Mantén todos los atributos existentes
3. Para ELIMINAR ATRIBUTOS de clase existente:
   - Copia la clase exactamente (mismo id, data.label, position, type)
   - Elimina SOLO el atributo específico del array "attributes"
   - Mantén todos los demás atributos intactos
   - NO elimines otros atributos
4. Para NUEVAS CLASES:
   - Copia exactamente todos los nodos existentes
   - Agrega las nuevas clases con IDs únicos
5. COPIA EXACTAMENTE todos los edges existentes (mismo id, source, target, data)
6. Posiciona las nuevas clases en ubicaciones libres (x > 800 o y > 600)
7. SOLO crea nuevas relaciones si el usuario las menciona explícitamente
8. Responde con el JSON completo: nodos (existentes modificados + nuevos) + edges existentes + edges nuevos (si aplica)

EJEMPLOS ESPECÍFICOS:
- "agregar atributo semestre a clase Aula": Busca Aula → Agrega semestre al array attributes
- "eliminar atributo codigo de clase Materia": Busca Materia → Elimina SOLO el atributo "codigo" del array attributes
- "quitar atributo piso de Aula": Busca Aula → Elimina SOLO el atributo "piso"
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

CASOS ESPECÍFICOS DE MODIFICACIÓN:
1. "Agregar atributo X a clase Y": Modifica la clase Y agregando el atributo X, mantén todo lo demás
2. "Eliminar atributo X de clase Y": Modifica la clase Y eliminando SOLO el atributo X, mantén todos los demás atributos
3. "Quitar atributo X de clase Y": Modifica la clase Y eliminando SOLO el atributo X, mantén todos los demás atributos
4. "Crear nueva clase Z": Agrega clase Z sin modificar las existentes  
5. "Agregar relación entre A y B": Agrega edge entre A y B, mantén clases y edges existentes
6. "Modificar atributo X de clase Y": Cambia solo ese atributo específico
7. NO crear diagrama desde cero - SIEMPRE partir del diagrama existente y aplicar solo las modificaciones solicitadas

`;

      // Usar OpenAI con reintentos
      let completion;
      let lastError;

      const models = ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];

      for (const model of models) {
        try {
          console.log(`🤖 Intentando con modelo OpenAI: ${model}`);

          const userMessage = hasExistingDiagram
            ? `🚨 MODIFICAR DIAGRAMA EXISTENTE: Ya existe un diagrama con ${currentDiagram?.nodes?.length || 0} clases y ${currentDiagram?.edges?.length || 0} relaciones. 

🎯 ANÁLISIS DE LA SOLICITUD: "${data.prompt}"

PASO A PASO PARA MODIFICAR CLASE EXISTENTE:

PARA AGREGAR ATRIBUTO:
1. Identifica si se menciona "agregar", "añadir" o "incluir" un atributo
2. Identifica el nombre de la clase a modificar
3. Busca en el diagrama actual el nodo con data.label igual al nombre de la clase
4. En el array "attributes" de esa clase, agrega el nuevo atributo con:
   - "id": "attr-" + timestamp único
   - "name": nombre del atributo
   - "type": tipo del atributo (String, int, boolean, etc.)
   - "visibility": "private" (por defecto)
5. Mantén TODOS los otros atributos y propiedades de la clase intactos

PARA ELIMINAR ATRIBUTO:
1. Identifica si se menciona "eliminar", "quitar", "remover" o "borrar" un atributo
2. Identifica el nombre de la clase y el atributo a eliminar
3. Busca en el diagrama actual el nodo con data.label igual al nombre de la clase
4. En el array "attributes" de esa clase, ELIMINA SOLO el atributo con el nombre especificado
5. Mantén TODOS los otros atributos y propiedades de la clase intactos

EJEMPLOS PRÁCTICOS:
Si solicitud = "agregar atributo semestre a clase Aula"
→ Buscar nodo con data.label = "Aula"
→ En su attributes array, agregar: {"id": "attr-1731340727000", "name": "semestre", "type": "String", "visibility": "private"}
→ Mantener todos los otros atributos existentes

Si solicitud = "eliminar atributo codigo de clase Materia"
→ Buscar nodo con data.label = "Materia"  
→ En su attributes array, ELIMINAR el atributo que tenga "name": "codigo"
→ Mantener todos los otros atributos existentes

FORMATO DE RESPUESTA OBLIGATORIO:
{
  "nodes": [
    {mismo nodo Aula pero con atributo semestre agregado},
    {todos los otros nodos copiados exactamente}
  ],
  "edges": [
    {todos los edges existentes copiados exactamente}
  ]
}

🚨 SOLICITUD ESPECÍFICA: ${data.prompt}

RESPUESTA REQUERIDA: JSON completo con la modificación aplicada

IMPORTANTE: Responde con el JSON completo del diagrama modificado, incluyendo TODO el contenido existente más las modificaciones solicitadas.`
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
            temperature: 0.3,
            response_format: { type: 'json_object' },
          });
          console.log(`Éxito con modelo OpenAI: ${model}`);
          break; // Si funciona, salir del loop
        } catch (error) {
          console.log(`Error con modelo ${model}:`, error.message);
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
      console.log(
        '🤖 Respuesta de OpenAI (primeros 500 chars):',
        responseText.substring(0, 500),
      );

      // Limpiar la respuesta de cualquier markdown (por si acaso)
      let cleanText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const diagramJson = JSON.parse(cleanText);
      console.log(
        '📊 Diagrama parseado - Nodos:',
        diagramJson.nodes?.length || 0,
        'Edges:',
        diagramJson.edges?.length || 0,
      );

      if (diagramJson.nodes) {
        console.log(
          '🏷️ Clases en respuesta:',
          diagramJson.nodes.map((n) => n.data?.label).filter(Boolean),
        );

        // Verificar si Aula tiene semestre
        const aulaNode = diagramJson.nodes.find(
          (n) => n.data?.label === 'Aula',
        );
        if (aulaNode) {
          console.log(
            '🎯 Clase Aula encontrada con atributos:',
            aulaNode.data.attributes?.map((a) => a.name) || [],
          );
        }
      }

      // Actualizar el diagrama en la base de datos
      const updatedDiagram = await this.diagramService.update(data.diagramId, {
        model: diagramJson,
      });
      console.log('💾 Diagrama actualizado en BD');

      // Emitir la respuesta al cliente
      client.emit('diagram-generated', {
        success: true,
        diagram: diagramJson,
        message: 'Diagrama generado exitosamente con OpenAI',
      });
      console.log('📤 Respuesta enviada al cliente');

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

  //PROCESAR FOTO
  @SubscribeMessage('process-diagram-image')
  async handleProcessDiagramImage(
    @MessageBody()
    data: {
      image: string; // base64 string
      diagramId: string;
      fileName?: string;
      currentDiagram?: { nodes: any[]; edges: any[] };
    },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      console.log(`📷 Procesando imagen de diagrama para: ${data.diagramId}`);

      // Obtener el diagrama actual si existe
      let currentDiagram = data.currentDiagram;
      if (!currentDiagram) {
        const diagram = await this.diagramService.findOne(data.diagramId);
        currentDiagram = (diagram as any).model || { nodes: [], edges: [] };
      }

      const hasExistingDiagram =
        currentDiagram?.nodes && currentDiagram.nodes.length > 0;

      // Preparar el prompt para el modelo de visión
      const visionPrompt = `
Analiza esta imagen de un diagrama de clases UML y genera un JSON con el formato especificado.

${
  hasExistingDiagram
    ? `
⚠️ DIAGRAMA EXISTENTE - Debes PRESERVAR y EXTENDER:
${JSON.stringify(currentDiagram, null, 2)}

INSTRUCCIONES:
1. COPIA todos los nodos y edges existentes
2. AGREGA las nuevas clases de la imagen
3. NO elimines nada del diagrama existente
`
    : 'Genera un diagrama nuevo desde cero.'
}

Identifica en la imagen:
1. Todas las clases (nombres, atributos con tipos y visibilidad)
2. Relaciones entre clases (herencia, asociación, composición, agregación, etc.)
3. Cardinalidades en las relaciones (1..1, 1..*, 0..1, *, etc.)

Formato JSON esperado (idéntico al que usamos):
{
  "nodes": [
    {
      "id": "node-[timestamp único]",
      "data": {
        "label": "NombreClase",
        "methods": [],
        "attributes": [
          {
            "id": "attr-[timestamp]",
            "name": "nombreAtributo",
            "type": "tipo de dato",
            "visibility": "public|private|protected"
          }
        ],
        "isAssociationClass": false
      },
      "type": "textUpdater",
      "position": {"x": número, "y": número}
    }
  ],
  "edges": [
    {
      "id": "edge-[source]-[target]-[type]-[timestamp]",
      "type": "inheritance|association|aggregation|composition|realization|dependency",
      "source": "node-id-origen",
      "target": "node-id-destino",
      "sourceHandle": "bottom|top|left|right",
      "targetHandle": "bottom|top|left|right",
      "data": {
        "type": "tipo de relación",
        "label": "etiqueta",
        "sourceCardinality": "cardinalidad origen",
        "targetCardinality": "cardinalidad destino"
      }
    }
  ]
}

IMPORTANTE:
- Responde SOLO con el JSON válido, SIN markdown
- Si no puedes leer algo en la imagen, usa valores razonables
- Asegúrate de que todos los IDs sean únicos
- Posiciona las clases de forma espaciada (incrementa x e y)
`;

      // Llamar a OpenAI con visión
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o', // Modelo con capacidad de visión
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: visionPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: data.image, // base64 image
                  detail: 'high', // alta resolución para mejor detalle
                },
              },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      const responseText = completion.choices[0]?.message?.content || '{}';

      // Limpiar respuesta
      let cleanText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const diagramJson = JSON.parse(cleanText);

      // Actualizar el diagrama en la base de datos
      const updatedDiagram = await this.diagramService.update(data.diagramId, {
        model: diagramJson,
      });

      // Emitir respuesta exitosa
      client.emit('diagram-image-processed', {
        success: true,
        diagram: diagramJson,
        message: 'Diagrama generado exitosamente desde la imagen',
      });

      // Notificar a otros participantes
      const room = `diagram:${data.diagramId}`;
      client.to(room).emit('diagram-updated', {
        id: updatedDiagram.id,
        model: updatedDiagram.model,
      });

      console.log(`✅ Imagen procesada exitosamente para: ${data.diagramId}`);
      console.log(updatedDiagram.model);
    } catch (error) {
      console.error('❌ Error procesando imagen:', error);
      client.emit('diagram-image-processed', {
        success: false,
        error: 'Error al procesar la imagen del diagrama',
        message: error.message,
      });
    }
  }
}
