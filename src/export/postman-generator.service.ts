//postman-generator.service.ts
import { Injectable } from '@nestjs/common';

interface ModelNodeAttr {
  id: string;
  name: string;
  type: string;
  visibility?: string;
}

interface ModelNode {
  id: string;
  data: {
    label: string;
    methods?: any[];
    attributes?: ModelNodeAttr[];
  };
}

interface ModelEdge {
  data?: {
    type?: string;
    label?: string;
    sourceCardinality?: string;
    targetCardinality?: string;
    associationClass?: string;
  };
  type?: string;
  source: string;
  target: string;
}

interface DiagramModel {
  nodes: ModelNode[];
  edges: ModelEdge[];
  metadata?: any;
}

@Injectable()
export class PostmanGeneratorService {
  generateCollectionsFromModel(model: DiagramModel): any {
    const nodes = model.nodes || [];
    const edges = model.edges || [];
    const items: any[] = [];

    // Mapa de nodos para obtener nombres de clases
    const nodeIdToClass: Record<string, string> = {};
    const attributesMap: Record<string, ModelNodeAttr[]> = {};

    for (const node of nodes) {
      const className = this.sanitizeClassName(node.data.label);
      nodeIdToClass[node.id] = className;
      attributesMap[className] = node.data.attributes || [];
    }

    // Detectar composiciones (para generar bodies correctos)
    const compositionChildren: Record<string, string> = {}; // hijo -> padre
    
    // Detectar herencia: hijo -> padre
    const inheritanceChildren: Record<string, string> = {}; // hijo -> padre
    
    // Detectar relaciones para cada clase
    const classRelations: Record<string, Array<{type: string, fieldName: string, targetClass: string}>> = {};
    
    for (const node of nodes) {
      const className = this.sanitizeClassName(node.data.label);
      classRelations[className] = [];
    }
    
    for (const edge of edges) {
      const sourceClass = nodeIdToClass[edge.source];
      const targetClass = nodeIdToClass[edge.target];
      
      if (!sourceClass || !targetClass) continue;
      
      const edgeType = edge.data?.type || edge.type;
      const sourceCard = edge.data?.sourceCardinality;
      const targetCard = edge.data?.targetCardinality;
      
      // DEBUG: Log para verificar detección de relaciones
      if (sourceClass === 'Cliente' || targetClass === 'Cliente' || 
          sourceClass === 'Empleado' || targetClass === 'Empleado' ||
          sourceClass === 'Estudiante' || targetClass === 'Estudiante') {
        console.log(`[Postman] ${sourceClass} (${sourceCard}) → ${targetClass} (${targetCard}) [${edgeType}]`);
      }
      
      // Herencia
      if (edgeType === 'inheritance') {
        inheritanceChildren[targetClass] = sourceClass; // hijo -> padre
        continue;
      }
      
      // Composición
      if (edgeType === 'composition') {
        compositionChildren[targetClass] = sourceClass;
        continue;
      }
      
      // Ignorar herencia
      if (edgeType === 'inheritance') {
        continue;
      }
      
      // Asociación con clase intermedia (debe procesarse PRIMERO)
      const assocClassId = edge.data?.associationClass;
      if (edgeType === 'association' && assocClassId && nodeIdToClass[assocClassId]) {
        const assocClass = nodeIdToClass[assocClassId];
        const sourceLower = sourceClass.charAt(0).toLowerCase() + sourceClass.slice(1);
        const targetLower = targetClass.charAt(0).toLowerCase() + targetClass.slice(1);
        
        // La clase de asociación tiene ManyToOne a ambas
        classRelations[assocClass] = classRelations[assocClass] || [];
        classRelations[assocClass].push({
          type: 'ManyToOne',
          fieldName: sourceLower,
          targetClass: sourceClass,
        });
        classRelations[assocClass].push({
          type: 'ManyToOne',
          fieldName: targetLower,
          targetClass: targetClass,
        });
        continue; // Ya procesamos esta asociación
      }
      
      // ManyToMany (sin clase de asociación)
      if (sourceCard?.includes('*') && targetCard?.includes('*') && !assocClassId) {
        const targetLower = targetClass.charAt(0).toLowerCase() + targetClass.slice(1);
        classRelations[sourceClass].push({
          type: 'ManyToMany',
          fieldName: `${targetLower}s`,
          targetClass: targetClass,
        });
        continue;
      }
      
      // OneToMany / ManyToOne
      // Ejemplo: Cliente (1) → (0..*) Factura
      // sourceCard = "1", targetCard = "0..*"
      // Factura (target) debe tener ManyToOne a Cliente (source)
      if (targetCard?.includes('*') && !sourceCard?.includes('*')) {
        // El lado "muchos" (target) tiene la FK al lado "uno" (source)
        const sourceLower = sourceClass.charAt(0).toLowerCase() + sourceClass.slice(1);
        classRelations[targetClass].push({
          type: 'ManyToOne',
          fieldName: sourceLower,
          targetClass: sourceClass,
        });
        continue;
      } else if (sourceCard?.includes('*') && !targetCard?.includes('*')) {
        // El lado "muchos" (source) tiene la FK al lado "uno" (target)
        const targetLower = targetClass.charAt(0).toLowerCase() + targetClass.slice(1);
        classRelations[sourceClass].push({
          type: 'ManyToOne',
          fieldName: targetLower,
          targetClass: targetClass,
        });
        continue;
      }
      
      // OneToOne
      // Solo procesamos si NO es ManyToMany ni tiene clase de asociación
      if (!sourceCard?.includes('*') && !targetCard?.includes('*') && !assocClassId) {
        // El source es el lado propietario (tiene la FK)
        const targetLower = targetClass.charAt(0).toLowerCase() + targetClass.slice(1);
        classRelations[sourceClass].push({
          type: 'OneToOne',
          fieldName: targetLower,
          targetClass: targetClass,
        });
        continue;
      }
    }

    // Crear items para cada clase
    for (const node of nodes) {
      const className = nodeIdToClass[node.id];
      const attributes = attributesMap[className] || [];
      const lowerClassName =
        className.charAt(0).toLowerCase() + className.slice(1);
      
      const parentClass = compositionChildren[className];
      const relations = classRelations[className] || [];
      
      // Si es hijo en herencia, agregar atributos del padre
      const inheritanceParent = inheritanceChildren[className];
      const parentAttributes = inheritanceParent ? attributesMap[inheritanceParent] || [] : [];

      const classItems = this.createItemsForClass(
        className,
        lowerClassName,
        attributes,
        parentClass,
        relations,
        parentAttributes,
      );
      items.push(...classItems);
    }

    return {
      info: {
        name: 'Generated API Collections',
        description:
          'Collections generadas automáticamente desde el diagrama UML',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: items,
      variable: [
        {
          key: 'baseUrl',
          value: 'http://localhost:8080',
          type: 'string',
        },
      ],
    };
  }

  private createItemsForClass(
    className: string,
    lowerClassName: string,
    attributes: ModelNodeAttr[],
    parentClass?: string, // Para composiciones
    relations?: Array<{type: string, fieldName: string, targetClass: string}>,
    parentAttributes?: ModelNodeAttr[], // Para herencia
  ): any[] {
    const baseUrl = '{{baseUrl}}';
    const endpoint = `/api/${lowerClassName}`;

    // Generar ejemplo de body para POST/PUT
    const exampleBody = this.generateExampleBody(className, attributes, parentClass, relations, parentAttributes);

    return [
      // GET all
      {
        name: `Get All ${className}s`,
        request: {
          method: 'GET',
          header: [
            {
              key: 'Accept',
              value: 'application/json',
            },
          ],
          url: {
            raw: `${baseUrl}${endpoint}`,
            host: ['{{baseUrl}}'],
            path: endpoint.split('/').filter((p) => p),
          },
          description: `Obtener todos los registros de ${className}`,
        },
        response: [],
      },

      // GET by ID
      {
        name: `Get ${className} by ID`,
        request: {
          method: 'GET',
          header: [
            {
              key: 'Accept',
              value: 'application/json',
            },
          ],
          url: {
            raw: `${baseUrl}${endpoint}/{{${lowerClassName}Id}}`,
            host: ['{{baseUrl}}'],
            path: [
              ...endpoint.split('/').filter((p) => p),
              `{{${lowerClassName}Id}}`,
            ],
          },
          description: `Obtener un ${className} específico por ID`,
        },
        response: [],
      },

      // POST
      {
        name: `Create ${className}`,
        request: {
          method: 'POST',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
            {
              key: 'Accept',
              value: 'application/json',
            },
          ],
          body: {
            mode: 'raw',
            raw: JSON.stringify(exampleBody, null, 2),
            options: {
              raw: {
                language: 'json',
              },
            },
          },
          url: {
            raw: `${baseUrl}${endpoint}`,
            host: ['{{baseUrl}}'],
            path: endpoint.split('/').filter((p) => p),
          },
          description: `Crear un nuevo ${className}.\n\n**NOTA**: Para asociar relaciones, usa el formato: \`"relacionNombre": {"id": 1}\` en lugar de \`"relacionNombreId": 1\`.\n\nEjemplo: \`"cliente": {"id": 1}\` o \`"detalle": {"id": 1}\``,
        },
        response: [],
      },

      // PUT
      {
        name: `Update ${className}`,
        request: {
          method: 'PUT',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
            {
              key: 'Accept',
              value: 'application/json',
            },
          ],
          body: {
            mode: 'raw',
            raw: JSON.stringify(exampleBody, null, 2),
            options: {
              raw: {
                language: 'json',
              },
            },
          },
          url: {
            raw: `${baseUrl}${endpoint}/{{${lowerClassName}Id}}`,
            host: ['{{baseUrl}}'],
            path: [
              ...endpoint.split('/').filter((p) => p),
              `{{${lowerClassName}Id}}`,
            ],
          },
          description: `Actualizar un ${className} existente`,
        },
        response: [],
      },

      // DELETE
      {
        name: `Delete ${className}`,
        request: {
          method: 'DELETE',
          header: [
            {
              key: 'Accept',
              value: 'application/json',
            },
          ],
          url: {
            raw: `${baseUrl}${endpoint}/{{${lowerClassName}Id}}`,
            host: ['{{baseUrl}}'],
            path: [
              ...endpoint.split('/').filter((p) => p),
              `{{${lowerClassName}Id}}`,
            ],
          },
          description: `Eliminar un ${className} por ID`,
        },
        response: [],
      },
    ];
  }

  private generateExampleBody(
    className: string,
    attributes: ModelNodeAttr[],
    parentClass?: string,
    relations?: Array<{type: string, fieldName: string, targetClass: string}>,
    parentAttributes?: ModelNodeAttr[],
  ): any {
    const body: any = {};

    // Si es composición, agregar el id compuesto y la referencia al padre
    if (parentClass) {
      const parentLower = parentClass.charAt(0).toLowerCase() + parentClass.slice(1);
      
      body.id = {
        id: 1,
        [`${parentLower}Id`]: 1,
      };
      
      body[parentLower] = {
        id: 1,
      };
    }

    // Si es herencia, agregar primero los atributos del padre (excepto id)
    if (parentAttributes) {
      for (const attr of parentAttributes) {
        if (attr.name === 'id') continue; // El id se auto-genera
        body[attr.name] = this.getExampleValue(attr.type, false);
      }
    }

    // Agregar atributos propios de la clase
    for (const attr of attributes) {
      if (attr.name === 'id' && parentClass) {
        // Si es composición, ya agregamos el id compuesto arriba
        continue;
      } else if (attr.name === 'id' && parentAttributes) {
        // Si es herencia, el id viene del padre, no se incluye en POST
        continue;
      } else if (attr.name === 'id') {
        // Para el ID normal, no incluirlo en POST (se auto-genera)
        continue;
      } else {
        body[attr.name] = this.getExampleValue(attr.type, false);
      }
    }
    
    // Agregar campos de relaciones (ManyToOne, OneToOne)
    if (relations) {
      for (const rel of relations) {
        if (rel.type === 'ManyToOne' || rel.type === 'OneToOne') {
          // Generar objeto anidado: { "cliente": { "id": 1 } }
          body[rel.fieldName] = {
            id: 1,
          };
        } else if (rel.type === 'ManyToMany') {
          // Generar array de objetos: { "categorias": [{ "id": 1 }, { "id": 2 }] }
          body[rel.fieldName] = [
            { id: 1 },
            { id: 2 },
          ];
        }
      }
    }

    return body;
  }

  private getExampleValue(type: string, isId: boolean = false): any {
    const lowerType = (type || '').toLowerCase();

    if (isId) {
      return 1; // ID de ejemplo
    }

    // Sincronizado con mapType() de spring-generator.service.ts
    switch (lowerType) {
      case 'int':
      case 'integer':
        return 100;
      case 'long':
        return 1000;
      case 'double':
        return 99.99;
      case 'float':
        return 49.95;
      case 'boolean':
        return true;
      case 'date':
        return '2025-11-08'; // formato ISO date
      case 'localdate':
        return '2025-11-08';
      case 'localdatetime':
      case 'datetime':
        return '2025-11-08T10:30:00'; // formato ISO datetime
      case 'bigdecimal':
      case 'decimal':
        return 1234.56;
      case 'byte':
        return 127;
      case 'short':
        return 32000;
      case 'character':
      case 'char':
        return 'A';
      case 'string':
      default:
        return 'Example String';
    }
  }

  private sanitizeClassName(label: string): string {
    return label
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^(.)/, (c) => c.toUpperCase());
  }
}
