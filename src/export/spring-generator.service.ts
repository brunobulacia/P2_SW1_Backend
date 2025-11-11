//spring-generator.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

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
export class SpringGeneratorService {

  private sanitizeFieldName(label: string): string {
    // Remover tildes y convertir ñ -> n
    const withoutAccents = label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remover diacríticos
      .replace(/ñ/g, 'n')
      .replace(/Ñ/g, 'N');
    
    return withoutAccents
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^(.)/, (c) => c.toLowerCase());
  }
  async generateFromModel(
    model: DiagramModel,
    outputRoot?: string,
  ): Promise<void> {
    // path base del package
    const basePackagePath = outputRoot
      ? path.join(outputRoot, 'src', 'main', 'java', 'com', 'example', 'demo')
      : path.join(
          process.cwd(),
          'demo',
          'src',
          'main',
          'java',
          'com',
          'example',
          'demo',
        );

    // si se especifica outputRoot, copiar skeleton demo/
    if (outputRoot) {
      const templateRoot = path.join(process.cwd(), 'demo');
      try {
        const pomSrc = path.join(templateRoot, 'pom.xml');
        if (fs.existsSync(pomSrc)) {
          this.ensureDir(outputRoot);
          fs.copyFileSync(pomSrc, path.join(outputRoot, 'pom.xml'));
        } else {
          throw new Error(`Template file not found: ${pomSrc}`);
        }

        const mvnw = path.join(templateRoot, 'mvnw');
        if (fs.existsSync(mvnw)) {
          fs.copyFileSync(mvnw, path.join(outputRoot, 'mvnw'));
          fs.chmodSync(path.join(outputRoot, 'mvnw'), 0o755);
        } else {
          console.warn(`Maven wrapper not found: ${mvnw}`);
        }
        
        const mvnwCmd = path.join(templateRoot, 'mvnw.cmd');
        if (fs.existsSync(mvnwCmd)) {
          fs.copyFileSync(mvnwCmd, path.join(outputRoot, 'mvnw.cmd'));
        } else {
          console.warn(`Maven wrapper CMD not found: ${mvnwCmd}`);
        }

        const mvnFolder = path.join(templateRoot, '.mvn');
        if (fs.existsSync(mvnFolder)) {
          this.copyRecursiveSync(mvnFolder, path.join(outputRoot, '.mvn'));
        } else {
          console.warn(`Maven folder not found: ${mvnFolder}`);
        }

        const resourcesSrc = path.join(
          templateRoot,
          'src',
          'main',
          'resources',
        );
        if (fs.existsSync(resourcesSrc)) {
          this.copyRecursiveSync(
            resourcesSrc,
            path.join(outputRoot, 'src', 'main', 'resources'),
          );
        }

        // Generar application.properties con configuración de H2
        const resourcesDir = path.join(outputRoot, 'src', 'main', 'resources');
        this.ensureDir(resourcesDir);
        const appProperties = `# H2 Database Configuration
spring.datasource.url=jdbc:h2:mem:testdb
spring.datasource.driverClassName=org.h2.Driver
spring.datasource.username=sa
spring.datasource.password=

# JPA/Hibernate
spring.jpa.database-platform=org.hibernate.dialect.H2Dialect
spring.jpa.hibernate.ddl-auto=create-drop
spring.jpa.show-sql=true

# H2 Console (opcional, útil para debugging)
spring.h2.console.enabled=true
spring.h2.console.path=/h2-console
`;
        fs.writeFileSync(
          path.join(resourcesDir, 'application.properties'),
          appProperties,
          'utf8',
        );

        const demoAppSrc = path.join(
          templateRoot,
          'src',
          'main',
          'java',
          'com',
          'example',
          'demo',
          'DemoApplication.java',
        );
        if (fs.existsSync(demoAppSrc)) {
          const demoAppDestDir = path.join(
            outputRoot,
            'src',
            'main',
            'java',
            'com',
            'example',
            'demo',
          );
          this.ensureDir(demoAppDestDir);
          fs.copyFileSync(
            demoAppSrc,
            path.join(demoAppDestDir, 'DemoApplication.java'),
          );
        } else {
          throw new Error(`DemoApplication.java template not found: ${demoAppSrc}`);
        }
      } catch (err) {
        console.error('Error copying template files:', err);
        throw new Error(`Failed to initialize Spring Boot project: ${err.message}`);
      }
    }

    // ensure dirs
    this.ensureDir(basePackagePath);
    const modelDir = path.join(basePackagePath, 'model');
    const repoDir = path.join(basePackagePath, 'repository');
    const serviceDir = path.join(basePackagePath, 'service');
    const controllerDir = path.join(basePackagePath, 'controller');
    this.ensureDir(modelDir);
    this.ensureDir(repoDir);
    this.ensureDir(serviceDir);
    this.ensureDir(controllerDir);

    const nodes = model.nodes || [];
    const edges = model.edges || [];

    // maps
    const nodeIdToClass: Record<string, string> = {};
    const attributesMap: Record<string, ModelNodeAttr[]> = {};
    for (const node of nodes) {
      const className = this.sanitizeClassName(node.data.label);
      nodeIdToClass[node.id] = className;
      attributesMap[className] = node.data.attributes || [];
    }

    const relationsMap: Record<
      string,
      {
        fields: string[];
        imports: Set<string>;
        relationshipCount: Record<string, number>;
        compositionChild?: {
          idClassName: string;
          parentClass: string;
          parentLower: string;
          childIdJavaType: string;
        };
        inheritance?: {
          isParent: boolean;
          isChild: boolean;
          parentClass?: string;
          discriminatorValue?: string;
        };
      }
    > = {};
    for (const node of nodes) {
      const className = nodeIdToClass[node.id];
      relationsMap[className] = {
        fields: [],
        imports: new Set(),
        relationshipCount: {},
      };
    }

    const isMany = (card?: string) => !!card && card.includes('*');

    // Mapa de herencia: padre → hijos y hijo → padre
    const parentToChildren: Record<string, string[]> = {};
    const childToParent: Record<string, string> = {};
    for (const edge of edges) {
      const isInheritance =
        edge.data?.type === 'inheritance' || edge.type === 'inheritance';
      if (!isInheritance) continue;
      const parentClass = nodeIdToClass[edge.source];
      const childClass = nodeIdToClass[edge.target];
      if (!parentClass || !childClass) continue;
      parentToChildren[parentClass] = parentToChildren[parentClass] || [];
      parentToChildren[parentClass].push(childClass);
      childToParent[childClass] = parentClass;
    }

    // Marcar metadata de herencia en relationsMap
    for (const className of Object.keys(relationsMap)) {
      const isParent = !!parentToChildren[className]?.length;
      const parentClass = childToParent[className];
      const isChild = !!parentClass;
      if (isParent || isChild) {
        const discriminatorValue = isChild
          ? className.charAt(0).toUpperCase()
          : undefined;
        relationsMap[className].inheritance = {
          isParent,
          isChild,
          parentClass,
          discriminatorValue,
        };
      }
    }

    // Para clases/id embebidos generados por composición
    const extraModelFiles: { name: string; content: string }[] = [];

    for (const edge of edges) {
      const sourceClass = nodeIdToClass[edge.source];
      const targetClass = nodeIdToClass[edge.target];
      if (!sourceClass || !targetClass) continue;

      const sourceCard = edge.data?.sourceCardinality;
      const targetCard = edge.data?.targetCardinality;

      const sourceHasManyTargets = isMany(targetCard);
      const targetHasManySources = isMany(sourceCard);

      const sourceLower =
        sourceClass.charAt(0).toLowerCase() + sourceClass.slice(1);
      const targetLower =
        targetClass.charAt(0).toLowerCase() + targetClass.slice(1);

      // Ignorar edges de herencia en el procesamiento de relaciones
      if (edge.data?.type === 'inheritance' || edge.type === 'inheritance') {
        continue;
      }

      // COMPOSITION: source (agregado) → target (parte) con PK compuesta
      if (edge.data?.type === 'composition') {
        // Lado padre/agregado
        relationsMap[sourceClass].imports.add('java.util.List');
        relationsMap[sourceClass].imports.add('jakarta.persistence.OneToMany');
        relationsMap[sourceClass].imports.add(
          'jakarta.persistence.CascadeType',
        );
        relationsMap[sourceClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonManagedReference',
        );
        relationsMap[sourceClass].fields.push(
          `    @OneToMany(mappedBy = "${sourceLower}", cascade = CascadeType.ALL, orphanRemoval = true)
    @JsonManagedReference("${sourceLower}_composition")
    private List<${targetClass}> ${targetLower}s;`,
        );

        // ID compuesto en el hijo: <Target>Id { <parent>Id, id }
        const childAttrs = attributesMap[targetClass] || [];
        const childIdAttr = childAttrs.find((a) => a.name === 'id');
        const childIdJavaType = this.mapType(childIdAttr?.type || 'Long');
        const idClassName = `${targetClass}Id`;

        relationsMap[targetClass].compositionChild = {
          idClassName,
          parentClass: sourceClass,
          parentLower: sourceLower,
          childIdJavaType,
        };

        const idClass = `package com.example.demo.model;

import jakarta.persistence.Embeddable;
import lombok.Data;
import lombok.NoArgsConstructor;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.io.Serializable;

@Data
@NoArgsConstructor
@Embeddable
public class ${idClassName} implements Serializable {
    @JsonProperty("${sourceLower}Id")
    private Long ${sourceLower}Id;
    
    @JsonProperty("id")
    private ${childIdJavaType} id;
    
    @JsonCreator
    public ${idClassName}(
        @JsonProperty("${sourceLower}Id") Long ${sourceLower}Id,
        @JsonProperty("id") ${childIdJavaType} id
    ) {
        this.${sourceLower}Id = ${sourceLower}Id;
        this.id = id;
    }
}`;
        extraModelFiles.push({ name: `${idClassName}.java`, content: idClass });

        relationsMap[targetClass].imports.add('jakarta.persistence.ManyToOne');
        relationsMap[targetClass].imports.add('jakarta.persistence.JoinColumn');
        relationsMap[targetClass].imports.add('jakarta.persistence.MapsId');
        relationsMap[targetClass].imports.add('jakarta.persistence.EmbeddedId');
        relationsMap[targetClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonBackReference',
        );
        relationsMap[targetClass].fields.push(
          `    @EmbeddedId
            @Setter(AccessLevel.NONE)
            private ${idClassName} id;`,
        );
        relationsMap[targetClass].fields.push(
          `    @ManyToOne(optional = false)
    @MapsId("${sourceLower}Id")
    @JoinColumn(name = "${sourceLower}_id")
    @JsonBackReference("${sourceLower}_composition")
    private ${sourceClass} ${sourceLower};`,
        );

        continue;
      }

      // Caso especial: Asociación con Clase de Asociación (join entity)
      // Si el edge declara una associationClass, generamos una entidad intermedia
      // con dos @ManyToOne y en los extremos usamos @OneToMany(mappedBy=...)
      const associationClassNodeId = edge.data?.associationClass;
      if (
        edge.data?.type === 'association' &&
        associationClassNodeId &&
        nodeIdToClass[associationClassNodeId]
      ) {
        const assocClass = nodeIdToClass[associationClassNodeId];
        const assocLower =
          assocClass.charAt(0).toLowerCase() + assocClass.slice(1);

        // Lado fuente: OneToMany a la clase de asociación
        relationsMap[sourceClass].imports.add('java.util.List');
        relationsMap[sourceClass].imports.add('jakarta.persistence.OneToMany');
        relationsMap[sourceClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonIgnore',
        );
        relationsMap[sourceClass].fields.push(
          `    @OneToMany(mappedBy = "${sourceLower}")
    @JsonIgnore
    private List<${assocClass}> ${assocLower}s;`,
        );

        // Lado target: OneToMany a la clase de asociación
        relationsMap[targetClass].imports.add('java.util.List');
        relationsMap[targetClass].imports.add('jakarta.persistence.OneToMany');
        relationsMap[targetClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonIgnore',
        );
        relationsMap[targetClass].fields.push(
          `    @OneToMany(mappedBy = "${targetLower}")
    @JsonIgnore
    private List<${assocClass}> ${assocLower}s;`,
        );

        // Clase de asociación: dos ManyToOne (hacia source y target)
        relationsMap[assocClass].imports.add('jakarta.persistence.ManyToOne');
        relationsMap[assocClass].imports.add('jakarta.persistence.JoinColumn');
        relationsMap[assocClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonBackReference',
        );

        relationsMap[assocClass].fields.push(
          `    @ManyToOne
    @JoinColumn(name = "${sourceLower}_id")
    @JsonBackReference("${sourceLower}_${assocLower}")
    private ${sourceClass} ${sourceLower};`,
        );

        relationsMap[assocClass].fields.push(
          `    @ManyToOne
    @JoinColumn(name = "${targetLower}_id")
    @JsonBackReference("${targetLower}")
    private ${targetClass} ${targetLower};`,
        );

        // Ya manejado como join-entity, continuar al próximo edge
        continue;
      }

      if (sourceHasManyTargets && targetHasManySources) {
        // Many-to-Many (lado source propietario)
        relationsMap[sourceClass].imports.add('java.util.List');
        relationsMap[sourceClass].imports.add('jakarta.persistence.ManyToMany');
        relationsMap[sourceClass].imports.add('jakarta.persistence.JoinTable');
        relationsMap[sourceClass].imports.add('jakarta.persistence.JoinColumn');
        relationsMap[sourceClass].imports.add('jakarta.persistence.FetchType');
        relationsMap[sourceClass].fields.push(
          `    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "${sourceLower}_${targetLower}", joinColumns = @JoinColumn(name = "${sourceLower}_id"), inverseJoinColumns = @JoinColumn(name = "${targetLower}_id"))
    private List<${targetClass}> ${targetLower}s;`,
        );

        relationsMap[targetClass].imports.add('java.util.List');
        relationsMap[targetClass].imports.add('jakarta.persistence.ManyToMany');
        relationsMap[targetClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonIgnore',
        );
        relationsMap[targetClass].fields.push(
          `    @ManyToMany(mappedBy = "${targetLower}s")
    @JsonIgnore
    private List<${sourceClass}> ${sourceLower}s;`,
        );
      } else if (sourceHasManyTargets) {
              // OneToMany (source) / ManyToOne (target)
        relationsMap[sourceClass].imports.add('java.util.List');
        relationsMap[sourceClass].imports.add('jakarta.persistence.OneToMany');
        relationsMap[sourceClass].imports.add('jakarta.persistence.FetchType');
        relationsMap[sourceClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonIgnoreProperties',
        );
        
        relationsMap[targetClass].imports.add('jakarta.persistence.ManyToOne');
        relationsMap[targetClass].imports.add('jakarta.persistence.JoinColumn');
        relationsMap[targetClass].imports.add('jakarta.persistence.FetchType');
        relationsMap[targetClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonIgnoreProperties',
        );
        const fieldName = edge.data?.label
          ? this.sanitizeFieldName(edge.data.label)
          : targetLower;
          relationsMap[sourceClass].fields.push(
            `    @OneToMany(mappedBy = "${sourceLower}", fetch = FetchType.EAGER)
            @JsonIgnoreProperties("${sourceLower}")
            private List<${targetClass}> ${fieldName}s;`,
          );
          relationsMap[targetClass].fields.push(
            `    @ManyToOne(fetch = FetchType.EAGER)
            @JoinColumn(name = "${sourceLower}_id")
            @JsonIgnoreProperties("${fieldName}s")
            private ${sourceClass} ${sourceLower};`,
          );

      } else if (targetHasManySources) {
        // OneToMany (target) / ManyToOne (source)
        relationsMap[targetClass].imports.add('java.util.List');
        relationsMap[targetClass].imports.add('jakarta.persistence.OneToMany');
        relationsMap[targetClass].imports.add('jakarta.persistence.FetchType');
        relationsMap[targetClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonIgnoreProperties',
        );
        relationsMap[sourceClass].imports.add('jakarta.persistence.ManyToOne');
        relationsMap[sourceClass].imports.add('jakarta.persistence.JoinColumn');
        relationsMap[sourceClass].imports.add('jakarta.persistence.FetchType');
        relationsMap[sourceClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonIgnoreProperties',
        );

        const fieldName = edge.data?.label
          ? this.sanitizeFieldName(edge.data.label)
          : sourceLower;  // Nota: aquí es sourceLower porque la relación va al revés

        relationsMap[targetClass].fields.push(
          `    @OneToMany(mappedBy = "${targetLower}", fetch = FetchType.EAGER)
          @JsonIgnoreProperties("${targetLower}")
          private List<${sourceClass}> ${fieldName}s;`,
        );

        relationsMap[sourceClass].fields.push(
          `    @ManyToOne(fetch = FetchType.EAGER)
          @JoinColumn(name = "${targetLower}_id")
          @JsonIgnoreProperties("${fieldName}s")
          private ${targetClass} ${targetLower};`,
        );
      } else {
        // One-to-One
        const fieldName = edge.data?.label 
          ? this.sanitizeFieldName(edge.data.label) 
          : targetLower;
        
        // Lado propietario (source)
        relationsMap[sourceClass].imports.add('jakarta.persistence.OneToOne');
        relationsMap[sourceClass].imports.add('jakarta.persistence.JoinColumn');
        relationsMap[sourceClass].imports.add('jakarta.persistence.FetchType');
        relationsMap[sourceClass].imports.add('com.fasterxml.jackson.annotation.JsonIgnoreProperties');
        relationsMap[sourceClass].fields.push(
          `    @OneToOne(fetch = FetchType.EAGER)
          @JoinColumn(name = "${fieldName}_id")
          @JsonIgnoreProperties("${sourceLower}")
          private ${targetClass} ${fieldName};`,
        );

        // Lado inverso (target) - USA EL MISMO fieldName
        relationsMap[targetClass].imports.add('jakarta.persistence.OneToOne');
        relationsMap[targetClass].imports.add('com.fasterxml.jackson.annotation.JsonIgnoreProperties');
        relationsMap[targetClass].fields.push(
          `    @OneToOne(mappedBy = "${fieldName}")  // ✅ Usa el nombre del campo en source
          @JsonIgnoreProperties("${fieldName}")
          private ${sourceClass} ${sourceLower};`,
        );
      }
    }

    // generar archivos
    for (const node of nodes) {
      const className = nodeIdToClass[node.id];
      const attributes = attributesMap[className] || [];
      const rel = relationsMap[className];

      const java = this.buildEntityWithRelations(className, attributes, rel);
      fs.writeFileSync(path.join(modelDir, `${className}.java`), java, 'utf8');

      const repo = this.buildRepository(className, rel);
      fs.writeFileSync(
        path.join(repoDir, `${className}Repository.java`),
        repo,
        'utf8',
      );

      const svc = this.buildService(className, rel);
      fs.writeFileSync(
        path.join(serviceDir, `${className}Service.java`),
        svc,
        'utf8',
      );

      const idType = rel?.compositionChild ? rel.compositionChild.idClassName : 'Long';
      const ctrl = this.buildController(
        className,
        rel?.inheritance?.isChild,
        rel?.inheritance?.parentClass,
        idType,
        rel,
      ); // <— con produces/consumes
      fs.writeFileSync(
        path.join(controllerDir, `${className}Controller.java`),
        ctrl,
        'utf8',
      );
    }

    // escribir modelos auxiliares (Ids embebidos)
    for (const f of extraModelFiles) {
      fs.writeFileSync(path.join(modelDir, f.name), f.content, 'utf8');
    }
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private copyRecursiveSync(src: string, dest: string) {
    const exists = fs.existsSync(src);
    const stats = exists ? fs.statSync(src) : null;
    const isDirectory = stats ? stats.isDirectory() : false;
    if (isDirectory) {
      this.ensureDir(dest);
      fs.readdirSync(src).forEach((child) => {
        this.copyRecursiveSync(path.join(src, child), path.join(dest, child));
      });
    } else if (exists) {
      this.ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
    }
  }

  private sanitizeClassName(label: string) {
    return label
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^(.)/, (c) => c.toUpperCase());
  }

  private mapType(attrType: string) {
  switch ((attrType || '').toLowerCase()) {
    case 'int':
    case 'integer':
      return 'Integer';
    
    case 'long':
      return 'Long';
    
    case 'double':
      return 'Double';
    
    case 'float':
      return 'Float';
    
    case 'boolean':
    case 'bool':
      return 'Boolean';
    
    case 'date':
      return 'java.util.Date';
    
    case 'localdate':
      return 'java.time.LocalDate';
    
    case 'localdatetime':
    case 'datetime':
      return 'java.time.LocalDateTime';
    
    case 'bigdecimal':
    case 'decimal':
      return 'java.math.BigDecimal';
    
    case 'byte':
      return 'Byte';
    
    case 'short':
      return 'Short';
    
    case 'char':
    case 'character':
      return 'Character';
    
    case 'string':
    case 'text':
    default:
      return 'String';
  }
}

private buildRepository(className: string, rel?: { 
  inheritance?: { 
    isChild: boolean; 
    parentClass?: string 
  };
  compositionChild?: {
    idClassName: string;
    parentClass: string;
    parentLower: string;
    childIdJavaType: string;
  };
}) {
  const isInheritanceChild = rel?.inheritance?.isChild;
  const idType = rel?.compositionChild ? rel.compositionChild.idClassName : 'Long';
  const idImport = rel?.compositionChild 
    ? `import com.example.demo.model.${rel.compositionChild.idClassName};` 
    : '';
  
  if (isInheritanceChild && rel?.inheritance?.parentClass) {
    // Repository para clase hija con queries personalizados
    return `package com.example.demo.repository;

import com.example.demo.model.${className};
${idImport}
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface ${className}Repository extends JpaRepository<${className}, ${idType}> {
    
    @Query("SELECT e FROM ${className} e WHERE e.id = :id AND TYPE(e) = ${className}")
    Optional<${className}> findById(@Param("id") ${idType} id);
    
    @Query("SELECT e FROM ${className} e WHERE TYPE(e) = ${className}")
    List<${className}> findAll();
}
`;
  }
  
  // Repository normal para clases sin herencia o padres
  return `package com.example.demo.repository;

import com.example.demo.model.${className};
${idImport}
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ${className}Repository extends JpaRepository<${className}, ${idType}> {
}
`;
}

private buildService(className: string, rel?: { 
  inheritance?: { 
    isChild: boolean; 
    parentClass?: string 
  };
  compositionChild?: {
    idClassName: string;
    parentClass: string;
    parentLower: string;
    childIdJavaType: string;
  };
}) {
  const isInheritanceChild = rel?.inheritance?.isChild;
  const idType = rel?.compositionChild ? rel.compositionChild.idClassName : 'Long';
  const idImport = rel?.compositionChild 
    ? `import com.example.demo.model.${rel.compositionChild.idClassName};` 
    : '';
  
  // Service es igual para todos, porque el Repository ya maneja el filtrado
  return `package com.example.demo.service;

import com.example.demo.model.${className};
import com.example.demo.repository.${className}Repository;
${idImport}
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;

@Service
public class ${className}Service {
    private final ${className}Repository repository;

    public ${className}Service(${className}Repository repository) {
        this.repository = repository;
    }

    public List<${className}> findAll() {
        return repository.findAll();
    }

    public Optional<${className}> findById(${idType} id) {
        return repository.findById(id);
    }

    public ${className} create(${className} entity) {
        return repository.save(entity);
    }

    public ${className} update(${idType} id, ${className} entity) {
        if (!repository.existsById(id)) {
            throw new RuntimeException("Entity not found with id: " + id);
        }
        // Para clases normales, establecer el ID manualmente
        ${rel?.compositionChild ? `// Composición: el ID compuesto ya viene en entity.id` : `// Establecer el ID para que JPA haga UPDATE en lugar de INSERT
        try {
            // Buscar campo 'id' en la clase actual Y en superclases (para herencia)
            java.lang.reflect.Field idField = null;
            Class<?> currentClass = ${className}.class;
            while (currentClass != null && idField == null) {
                try {
                    idField = currentClass.getDeclaredField("id");
                } catch (NoSuchFieldException e) {
                    currentClass = currentClass.getSuperclass();
                    if (currentClass == Object.class) {
                        currentClass = null;
                    }
                }
            }
            if (idField != null) {
                idField.setAccessible(true);
                idField.set(entity, id);
            }
        } catch (Exception e) {
            // Si falla reflexión, intentar con método setter si existe
        }`}
        return repository.save(entity);
    }

    public void delete(${idType} id) {
        repository.deleteById(id);
    }
}
`;
}

  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  // CAMBIO IMPORTANTE: controller con produces/consumes explícitos
  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  private buildController(
    className: string,
    isInheritanceChild?: boolean,
    parentClass?: string,
    idType: string = 'Long',
    rel?: { compositionChild?: { idClassName: string } },
  ) {
    const lower = className.charAt(0).toLowerCase() + className.slice(1);
    const idImport = rel?.compositionChild 
      ? `import com.example.demo.model.${rel.compositionChild.idClassName};` 
      : '';
    const baseController = `package com.example.demo.controller;

import com.example.demo.model.${className};
import com.example.demo.service.${className}Service;
${idImport}
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

@RestController
@RequestMapping("/api/${lower}")
public class ${className}Controller {
    private final ${className}Service service;
    
    @PersistenceContext
    private EntityManager entityManager;

    public ${className}Controller(${className}Service service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<${className}> all() {
        return service.findAll();
    }

    ${rel?.compositionChild 
      ? `@GetMapping(path = "/{idStr}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<${className}> get(@PathVariable String idStr) {
        // Parse composite ID: "1,2" → ItemPedidoId(id=1, pedidoId=2)
        String[] parts = idStr.split(",");
        ${idType} id = new ${idType}();
        try {
            java.lang.reflect.Field[] fields = ${idType}.class.getDeclaredFields();
            for (int i = 0; i < parts.length && i < fields.length; i++) {
                fields[i].setAccessible(true);
                Class<?> fieldType = fields[i].getType();
                if (fieldType == Long.class || fieldType == long.class) {
                    fields[i].set(id, Long.parseLong(parts[i]));
                } else if (fieldType == Integer.class || fieldType == int.class) {
                    fields[i].set(id, Integer.parseInt(parts[i]));
                } else {
                    fields[i].set(id, parts[i]);
                }
            }
        } catch (Exception e) {
            return ResponseEntity.badRequest().build();
        }
        return service.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }`
      : `@GetMapping(path = "/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<${className}> get(@PathVariable ${idType} id) {
        return service.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }`}

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ${className} create(@RequestBody Map<String, Object> payload) throws Exception {
        ${className} entity = new ${className}();
        
        // Usar reflexión para setear campos simples y resolver referencias OneToOne/ManyToOne
        for (Map.Entry<String, Object> entry : payload.entrySet()) {
            String fieldName = entry.getKey();
            Object value = entry.getValue();
            
            try {
                // Buscar campo en la clase actual Y en superclases (para herencia)
                java.lang.reflect.Field field = null;
                Class<?> currentClass = ${className}.class;
                while (currentClass != null && field == null) {
                    try {
                        field = currentClass.getDeclaredField(fieldName);
                    } catch (NoSuchFieldException e) {
                        // Si no se encuentra, buscar en la superclase
                        // PERO solo si no es Object (termina el loop)
                        currentClass = currentClass.getSuperclass();
                        if (currentClass == Object.class) {
                            currentClass = null;
                        }
                    }
                }
                
                if (field == null) {
                    continue; // Campo no existe, ignorar
                }
                
                field.setAccessible(true);
                Class<?> fieldType = field.getType();
                
                // SKIP: Si es un campo "id" en una entidad con @EmbeddedId (composición)
                // El ID compuesto se genera automáticamente, no debe setearse manualmente
                if (fieldName.equals("id") && field.getAnnotation(jakarta.persistence.EmbeddedId.class) != null) {
                    continue;
                }
                
                // Si es una List (ManyToMany o OneToMany), procesar como colección
                if (value instanceof java.util.List && java.util.List.class.isAssignableFrom(fieldType)) {
                    java.util.List<?> listValue = (java.util.List<?>) value;
                    java.util.List<Object> entities = new java.util.ArrayList<>();
                    
                    // Obtener el tipo genérico de la lista
                    java.lang.reflect.ParameterizedType paramType = (java.lang.reflect.ParameterizedType) field.getGenericType();
                    Class<?> elementType = (Class<?>) paramType.getActualTypeArguments()[0];
                    
                    for (Object item : listValue) {
                        if (item instanceof Map) {
                            Map<String, Object> itemMap = (Map<String, Object>) item;
                            if (itemMap.containsKey("id")) {
                                Long id = itemMap.get("id") instanceof Number 
                                    ? ((Number) itemMap.get("id")).longValue() 
                                    : Long.parseLong(itemMap.get("id").toString());
                                Object relatedEntity = entityManager.getReference(elementType, id);
                                entities.add(relatedEntity);
                            }
                        }
                    }
                    field.set(entity, entities);
                }
                // Si es una relación (viene como Map con {id: X}), resolver la referencia
                else if (value instanceof Map) {
                    Map<String, Object> refMap = (Map<String, Object>) value;
                    if (refMap.containsKey("id")) {
                        Object refId = refMap.get("id");
                        
                        try {
                            // Usar EntityManager.getReference() para crear proxy lazy
                            // Esto NO consulta la BD, solo crea una referencia
                            Long id = refId instanceof Number ? ((Number) refId).longValue() : Long.parseLong(refId.toString());
                            Object relatedEntity = entityManager.getReference(fieldType, id);
                            field.set(entity, relatedEntity);
                        } catch (Exception e) {
                            // Si falla, ignorar
                        }
                    }
                } else {
                    // Campo simple, setear directamente
                    if (value != null) {
                        if (fieldType == Long.class || fieldType == long.class) {
                            field.set(entity, ((Number) value).longValue());
                        } else if (fieldType == Integer.class || fieldType == int.class) {
                            field.set(entity, ((Number) value).intValue());
                        } else if (fieldType == Double.class || fieldType == double.class) {
                            field.set(entity, ((Number) value).doubleValue());
                        } else if (fieldType == Float.class || fieldType == float.class) {
                            field.set(entity, ((Number) value).floatValue());
                        } else if (fieldType == java.math.BigDecimal.class) {
                            // BigDecimal: convertir desde Number
                            if (value instanceof Number) {
                                field.set(entity, new java.math.BigDecimal(value.toString()));
                            } else if (value instanceof String) {
                                field.set(entity, new java.math.BigDecimal((String) value));
                            }
                        } else if (fieldType == Boolean.class || fieldType == boolean.class) {
                            field.set(entity, (Boolean) value);
                        } else if (fieldType == String.class) {
                            field.set(entity, value.toString());
                        } else if (fieldType == java.util.Date.class && value instanceof String) {
                            // Date: parsear desde String ISO "2025-11-09T00:00:00.000Z"
                            String dateStr = (String) value;
                            try {
                                // Intentar parsear con SimpleDateFormat
                                java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS");
                                field.set(entity, sdf.parse(dateStr));
                            } catch (Exception e) {
                                // Si falla, intentar solo fecha
                                try {
                                    if (dateStr.contains("T")) {
                                        dateStr = dateStr.substring(0, dateStr.indexOf("T"));
                                    }
                                    java.text.SimpleDateFormat sdf2 = new java.text.SimpleDateFormat("yyyy-MM-dd");
                                    field.set(entity, sdf2.parse(dateStr));
                                } catch (Exception e2) {
                                    // Ignorar si no se puede parsear
                                }
                            }
                        } else if (fieldType == java.time.LocalDate.class && value instanceof String) {
                            // LocalDate: aceptar "2025-11-09" o "2025-11-09T00:00:00.000"
                            String dateStr = (String) value;
                            if (dateStr.contains("T")) {
                                // Tiene hora, extraer solo la fecha
                                dateStr = dateStr.substring(0, dateStr.indexOf("T"));
                            }
                            field.set(entity, java.time.LocalDate.parse(dateStr));
                        } else if (fieldType == java.time.LocalDateTime.class && value instanceof String) {
                            field.set(entity, java.time.LocalDateTime.parse((String) value));
                        } else {
                            field.set(entity, value);
                        }
                    }
                }
            } catch (Exception e) {
                // Ignorar errores de reflexión
            }
        }
        
        // POST-PROCESAMIENTO para entidades con @EmbeddedId (composiciones)
        // Hibernate necesita que el @EmbeddedId esté completo antes de persist()
        try {
            java.lang.reflect.Field[] allFields = ${className}.class.getDeclaredFields();
            for (java.lang.reflect.Field f : allFields) {
                if (f.getAnnotation(jakarta.persistence.EmbeddedId.class) != null) {
                    f.setAccessible(true);
                    Object embeddedId = f.get(entity);
                    
                    // Si el @EmbeddedId es null, instanciarlo
                    if (embeddedId == null) {
                        Class<?> embeddedIdType = f.getType();
                        embeddedId = embeddedIdType.getDeclaredConstructor().newInstance();
                        f.set(entity, embeddedId);
                    }
                    
                    // Buscar campo con @MapsId para poblar el ID compuesto
                    for (java.lang.reflect.Field relField : allFields) {
                        jakarta.persistence.MapsId mapsId = relField.getAnnotation(jakarta.persistence.MapsId.class);
                        if (mapsId != null) {
                            relField.setAccessible(true);
                            Object relatedEntity = relField.get(entity);
                            
                            if (relatedEntity != null) {
                                // Obtener el ID de la entidad relacionada
                                java.lang.reflect.Field relIdField = null;
                                Class<?> relClass = relatedEntity.getClass();
                                while (relClass != null && relIdField == null) {
                                    try {
                                        relIdField = relClass.getDeclaredField("id");
                                    } catch (NoSuchFieldException e) {
                                        relClass = relClass.getSuperclass();
                                        if (relClass == Object.class) relClass = null;
                                    }
                                }
                                
                                if (relIdField != null) {
                                    relIdField.setAccessible(true);
                                    Object relId = relIdField.get(relatedEntity);
                                    
                                    // Setear el campo del @EmbeddedId con el nombre del @MapsId
                                    String fieldNameInId = mapsId.value();
                                    java.lang.reflect.Field idComponentField = embeddedId.getClass().getDeclaredField(fieldNameInId);
                                    idComponentField.setAccessible(true);
                                    idComponentField.set(embeddedId, relId);
                                    
                                    // Generar el campo 'id' del @EmbeddedId (auto-increment manual)
                                    java.lang.reflect.Field seqField = embeddedId.getClass().getDeclaredField("id");
                                    seqField.setAccessible(true);
                                    
                                    // Buscar el máximo id existente para este parent
                                    Long maxId = 0L;
                                    try {
                                        jakarta.persistence.Query q = entityManager.createQuery(
                                            "SELECT MAX(e.id.id) FROM " + entity.getClass().getSimpleName() + " e WHERE e.id." + fieldNameInId + " = :parentId"
                                        );
                                        q.setParameter("parentId", relId);
                                        Object result = q.getSingleResult();
                                        if (result != null) {
                                            maxId = ((Number) result).longValue();
                                        }
                                    } catch (Exception ex) {
                                        // Si falla la query, usar 0
                                    }
                                    
                                    seqField.set(embeddedId, maxId + 1);
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            // Ignorar si no hay @EmbeddedId
        }
        
        return service.create(entity);
    }

    ${rel?.compositionChild
      ? `@PutMapping(path = "/{idStr}", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ${className} update(@PathVariable String idStr, @RequestBody ${className} entity) {
        String[] parts = idStr.split(",");
        ${idType} id = new ${idType}();
        try {
            java.lang.reflect.Field[] fields = ${idType}.class.getDeclaredFields();
            for (int i = 0; i < parts.length && i < fields.length; i++) {
                fields[i].setAccessible(true);
                Class<?> fieldType = fields[i].getType();
                if (fieldType == Long.class || fieldType == long.class) {
                    fields[i].set(id, Long.parseLong(parts[i]));
                } else if (fieldType == Integer.class || fieldType == int.class) {
                    fields[i].set(id, Integer.parseInt(parts[i]));
                } else {
                    fields[i].set(id, parts[i]);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Invalid composite ID format");
        }
        return service.update(id, entity);
    }`
      : `@PutMapping(path = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ${className} update(@PathVariable ${idType} id, @RequestBody ${className} entity) {
        return service.update(id, entity);
    }`}

    ${rel?.compositionChild
      ? `@DeleteMapping(path = "/{idStr}")
    public ResponseEntity<Void> delete(@PathVariable String idStr) {
        String[] parts = idStr.split(",");
        ${idType} id = new ${idType}();
        try {
            java.lang.reflect.Field[] fields = ${idType}.class.getDeclaredFields();
            for (int i = 0; i < parts.length && i < fields.length; i++) {
                fields[i].setAccessible(true);
                Class<?> fieldType = fields[i].getType();
                if (fieldType == Long.class || fieldType == long.class) {
                    fields[i].set(id, Long.parseLong(parts[i]));
                } else if (fieldType == Integer.class || fieldType == int.class) {
                    fields[i].set(id, Integer.parseInt(parts[i]));
                } else {
                    fields[i].set(id, parts[i]);
                }
            }
        } catch (Exception e) {
            return ResponseEntity.badRequest().build();
        }
        service.delete(id);
        return ResponseEntity.noContent().build();
    }`
      : `@DeleteMapping(path = "/{id}")
    public ResponseEntity<Void> delete(@PathVariable ${idType} id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }`}
}`;

    // Si es clase hija, agregar endpoints específicos que filtren por tipo
    if (isInheritanceChild && parentClass) {
      // Remover la última llave de cierre de la clase
      const baseControllerWithoutClosing = baseController.replace(/\}\s*$/, '');

      return (
        baseControllerWithoutClosing +
        `

    // Endpoints específicos para ${className} (filtrados por tipo)
    @GetMapping(path = "/${lower}s", produces = MediaType.APPLICATION_JSON_VALUE)
    public List<${className}> all${className}s() {
        return service.findAll().stream()
                .filter(v -> v instanceof ${className})
                .map(v -> (${className}) v)
                .collect(Collectors.toList());
    }

    @GetMapping(path = "/${lower}s/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<${className}> get${className}(@PathVariable ${idType} id) {
        return service.findById(id)
                .filter(v -> v instanceof ${className})
                .map(v -> (${className}) v)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
`
      );
    }

    return baseController;
  }

  private buildEntityWithRelations(
    className: string,
    attributes: ModelNodeAttr[],
    rel:
      | {
          fields: string[];
          imports: Set<string>;
          inheritance?: {
            isParent: boolean;
            isChild: boolean;
            parentClass?: string;
            discriminatorValue?: string;
          };
          compositionChild?: {
            idClassName: string;
            parentClass: string;
            parentLower: string;
            childIdJavaType: string;
          };
        }
      | undefined,
  ) {
    const fields: string[] = [];

    // imports: declarar ANTES de usarlo en el loop
    const imports = new Set<string>([
      'import jakarta.persistence.*;',
      'import lombok.Data;',
      'import com.fasterxml.jackson.annotation.JsonBackReference;',
      'import com.fasterxml.jackson.annotation.JsonManagedReference;',
      'import lombok.NoArgsConstructor;',
      'import lombok.AllArgsConstructor;',
      'import com.fasterxml.jackson.annotation.JsonIgnoreProperties;'
    ]);

    // id: si es hijo en herencia JOINED, NO declarar id aquí (usa PK del padre)
    // id: si es hijo en composición, NO declarar id aquí (usa @EmbeddedId)
    const isInheritanceChild = !!rel?.inheritance?.isChild;
    const isCompositionChild = !!rel?.compositionChild;
    
    if (!isInheritanceChild && !isCompositionChild) {
      // SIEMPRE usar @GeneratedValue para clases normales y padres de herencia
      // Solo se omite @GeneratedValue en composiciones con @EmbeddedId
      fields.push(
        `    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;`,
      );
    }

    // atributos simples (SKIP 'id' porque ya fue manejado arriba o en @EmbeddedId)
    for (const attr of attributes) {
      if (attr.name === 'id') continue;
      const t = this.mapType(attr.type);
      const sanitizedName = this.sanitizeFieldName(attr.name);
      fields.push(`    private ${t} ${sanitizedName};`);
      
      // Agregar imports para tipos de fecha/tiempo si se detectan
      const attrTypeLower = (attr.type || '').toLowerCase();
      if (attrTypeLower === 'date') {
        imports.add('import java.util.Date;');
      } else if (attrTypeLower === 'localdate') {
        imports.add('import java.time.LocalDate;');
      } else if (attrTypeLower === 'localdatetime' || attrTypeLower === 'datetime') {
        imports.add('import java.time.LocalDateTime;');
      } else if (attrTypeLower === 'bigdecimal' || attrTypeLower === 'decimal') {
        imports.add('import java.math.BigDecimal;');
      }
    }

    // relaciones
    const relFields = rel?.fields || [];

    // Importes adicionales para herencia
    if (rel?.inheritance?.isParent) {
      imports.add('import jakarta.persistence.Inheritance;');
      imports.add('import jakarta.persistence.InheritanceType;');
      imports.add('import jakarta.persistence.DiscriminatorColumn;');
      imports.add('import jakarta.persistence.DiscriminatorType;');
      imports.add('import jakarta.persistence.DiscriminatorValue;');
    }
    // Importes adicionales para composición
    if (rel?.compositionChild) {
      imports.add('import lombok.Setter;');
      imports.add('import lombok.AccessLevel;');
    }
    if (rel?.inheritance?.isChild) {
      imports.add('import jakarta.persistence.DiscriminatorValue;');
      imports.add('import jakarta.persistence.PrimaryKeyJoinColumn;');
    }
    if (rel?.imports) {
      for (const imp of rel.imports) imports.add(`import ${imp};`);
    }

    // ⬇️⮕ AQUÍ construimos el body con @NoArgsConstructor y @AllArgsConstructor
    // Anotaciones de herencia a nivel de clase
    const classAnnotations: string[] = [];
    if (rel?.inheritance?.isParent) {
      classAnnotations.push(
        '@Inheritance(strategy = InheritanceType.JOINED)',
        '@DiscriminatorColumn(name = "tipoHijo", discriminatorType = DiscriminatorType.STRING, length = 1)',
      );
      // Valor por defecto cuando se persiste el padre (H2 exige un char(1))
      const dvParent = className.charAt(0).toUpperCase();
      classAnnotations.push(`@DiscriminatorValue("${dvParent}")`);
    }
    if (rel?.inheritance?.isChild && rel.inheritance.parentClass) {
      const dv =
        rel.inheritance.discriminatorValue || className.charAt(0).toUpperCase();
      classAnnotations.push(
        `@DiscriminatorValue("${dv}")`,
        '@PrimaryKeyJoinColumn(name = "id")',
      );
    }

    const extendsClause =
      rel?.inheritance?.isChild && rel.inheritance?.parentClass
        ? ` extends ${rel.inheritance.parentClass}`
        : '';

    const body = `package com.example.demo.model;

${Array.from(imports).join('\n')}

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@JsonIgnoreProperties({"hibernateLazyInitializer", "handler"})
${classAnnotations.join('\n')}
public class ${className}${extendsClause} {
${fields.join('\n\n')}

${relFields.join('\n\n')}
}`;

    return body;
  }
  // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
}
