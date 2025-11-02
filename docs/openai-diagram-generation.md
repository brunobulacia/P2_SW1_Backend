# Generación de Diagramas con OpenAI

## Cómo usar el endpoint de generación de diagramas

### WebSocket Event: `generate-diagram`

Este evento permite generar o modificar diagramas UML usando OpenAI.

### Estructura del mensaje

```typescript
{
  prompt: string;           // La descripción de lo que se quiere agregar
  diagramId: string;        // ID del diagrama en la BD
  currentDiagram?: {        // OPCIONAL pero RECOMENDADO
    nodes: Array<Node>;     // Nodos actuales del diagrama
    edges: Array<Edge>;     // Relaciones actuales del diagrama
  }
}
```

### ⚠️ IMPORTANTE: Para agregar clases a un diagrama existente

Si quieres **agregar nuevas clases** a un diagrama existente sin perderlo, **DEBES enviar el `currentDiagram`**:

```typescript
// ❌ INCORRECTO - Esto creará un diagrama nuevo
socket.emit('generate-diagram', {
  prompt: 'Agrega una clase Materia',
  diagramId: 'abc123',
});

// ✅ CORRECTO - Esto preservará el diagrama existente
socket.emit('generate-diagram', {
  prompt: 'Agrega una clase Materia con atributos codigo y nombre',
  diagramId: 'abc123',
  currentDiagram: {
    nodes: diagram.nodes, // Los nodos actuales
    edges: diagram.edges, // Las relaciones actuales
  },
});
```

### Ejemplos de prompts

#### Para crear un diagrama nuevo:

```typescript
socket.emit('generate-diagram', {
  prompt:
    'Crea un diagrama de un sistema de biblioteca con clases Libro, Usuario y Préstamo',
  diagramId: 'nuevo-diagrama-id',
});
```

#### Para agregar clases a un diagrama existente:

```typescript
socket.emit('generate-diagram', {
  prompt:
    'Agrega una clase Editorial con atributos nombre, pais y anioFundacion',
  diagramId: 'diagrama-existente-id',
  currentDiagram: currentDiagramData,
});
```

#### Para agregar clases con relaciones:

```typescript
socket.emit('generate-diagram', {
  prompt:
    'Agrega una clase Categoria que tenga una relación uno-a-muchos con Producto',
  diagramId: 'diagrama-existente-id',
  currentDiagram: currentDiagramData,
});
```

### Comportamiento

1. **Si NO envías `currentDiagram`**: El backend lo buscará en la base de datos
2. **Si el diagrama está vacío**: Se genera uno completamente nuevo
3. **Si el diagrama tiene clases**: OpenAI preservará todas las clases y relaciones existentes, y solo agregará lo solicitado

### Respuesta

El evento responde con:

```typescript
// Éxito
{
  success: true,
  diagram: {
    nodes: [...],
    edges: [...]
  },
  message: 'Diagrama generado exitosamente con OpenAI'
}

// Error
{
  success: false,
  error: 'Mensaje de error...',
  message: 'Detalles del error'
}
```

### Tips para mejores resultados

1. **Sé específico** en tus prompts: menciona atributos, tipos de datos y relaciones
2. **Usa lenguaje claro**: "Agrega una clase X con atributos A, B, C"
3. **Para relaciones**: especifica el tipo (uno-a-muchos, muchos-a-muchos, herencia, etc.)
4. **Envía siempre el diagrama actual** cuando quieras modificarlo

### Ejemplo completo en React/TypeScript

```typescript
// En tu componente frontend
const agregarClase = async () => {
  socket.emit('generate-diagram', {
    prompt:
      'Agrega una clase Materia con atributos: codigo (string), nombre (string)',
    diagramId: diagramId,
    currentDiagram: {
      nodes: nodes, // Estado actual de ReactFlow
      edges: edges, // Estado actual de ReactFlow
    },
  });
};

// Escuchar la respuesta
socket.on('diagram-generated', (response) => {
  if (response.success) {
    setNodes(response.diagram.nodes);
    setEdges(response.diagram.edges);
    console.log('✅ Diagrama actualizado');
  } else {
    console.error('❌ Error:', response.error);
  }
});
```

## Configuración necesaria

Asegúrate de tener la variable de entorno configurada:

```env
OPENAI_API_KEY=sk-proj-...tu-api-key...
```

## Modelos disponibles

El sistema intenta usar estos modelos en orden:

1. `gpt-4o` (recomendado, más preciso)
2. `gpt-4-turbo` (fallback)
3. `gpt-3.5-turbo` (fallback final)

Si un modelo falla o está sobrecargado, automáticamente prueba con el siguiente.
