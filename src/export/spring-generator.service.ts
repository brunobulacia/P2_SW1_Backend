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
  return label
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
        relationsMap[sourceClass].fields.push(
          `    @ManyToMany
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
        relationsMap[sourceClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonManagedReference',
        );
        
        relationsMap[targetClass].imports.add('jakarta.persistence.ManyToOne');
        relationsMap[targetClass].imports.add('jakarta.persistence.JoinColumn');
        relationsMap[targetClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonBackReference',
        );
        const fieldName = edge.data?.label
          ? this.sanitizeFieldName(edge.data.label)
          : targetLower;
          relationsMap[sourceClass].fields.push(
            `    @OneToMany(mappedBy = "${sourceLower}")
            @JsonManagedReference("${sourceLower}_${fieldName}")
            private List<${targetClass}> ${fieldName}s;`,
          );
          relationsMap[targetClass].fields.push(
            `    @ManyToOne
            @JoinColumn(name = "${sourceLower}_id")
            @JsonBackReference("${sourceLower}_${fieldName}")
            private ${sourceClass} ${sourceLower};`,
          );

      } else if (targetHasManySources) {
        // OneToMany (target) / ManyToOne (source)
        relationsMap[targetClass].imports.add('java.util.List');
        relationsMap[targetClass].imports.add('jakarta.persistence.OneToMany');
        relationsMap[targetClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonManagedReference',
        );
        relationsMap[sourceClass].imports.add('jakarta.persistence.ManyToOne');
        relationsMap[sourceClass].imports.add('jakarta.persistence.JoinColumn');
        relationsMap[sourceClass].imports.add(
          'com.fasterxml.jackson.annotation.JsonBackReference',
        );

        const fieldName = edge.data?.label
          ? this.sanitizeFieldName(edge.data.label)
          : sourceLower;  // Nota: aquí es sourceLower porque la relación va al revés

        relationsMap[targetClass].fields.push(
          `    @OneToMany(mappedBy = "${targetLower}")
          @JsonManagedReference("${targetLower}_${fieldName}")
          private List<${sourceClass}> ${fieldName}s;`,
        );

        relationsMap[sourceClass].fields.push(
          `    @ManyToOne
          @JoinColumn(name = "${targetLower}_id")
          @JsonBackReference("${targetLower}_${fieldName}")
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
        relationsMap[sourceClass].imports.add('com.fasterxml.jackson.annotation.JsonManagedReference');
        relationsMap[sourceClass].fields.push(
          `    @OneToOne
          @JoinColumn(name = "${fieldName}_id")
          @JsonManagedReference("${sourceLower}_${fieldName}")
          private ${targetClass} ${fieldName};`,
        );

        // Lado inverso (target) - USA EL MISMO fieldName
        relationsMap[targetClass].imports.add('jakarta.persistence.OneToOne');
        relationsMap[targetClass].imports.add('com.fasterxml.jackson.annotation.JsonBackReference');
        relationsMap[targetClass].fields.push(
          `    @OneToOne(mappedBy = "${fieldName}")  // ✅ Usa el nombre del campo en source
          @JsonBackReference("${sourceLower}_${fieldName}")
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
        // No usar setId() porque puede no existir en clases hijas o composición
        // JPA maneja el ID automáticamente al hacer save() en una entidad existente
        if (!repository.existsById(id)) {
            throw new RuntimeException("Entity not found with id: " + id);
        }
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
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/${lower}")
public class ${className}Controller {
    private final ${className}Service service;

    public ${className}Controller(${className}Service service) {
        this.service = service;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<${className}> all() {
        return service.findAll();
    }

    @GetMapping(path = "/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<${className}> get(@PathVariable ${idType} id) {
        return service.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ${className} create(@RequestBody ${className} entity) {
        return service.create(entity);
    }

    @PutMapping(path = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ${className} update(@PathVariable ${idType} id, @RequestBody ${className} entity) {
        return service.update(id, entity);
    }

    @DeleteMapping(path = "/{id}")
    public ResponseEntity<Void> delete(@PathVariable ${idType} id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
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
      fields.push(`    private ${t} ${attr.name};`);
      
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
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
${classAnnotations.join('\n')}
public class ${className}${extendsClause} {
${fields.join('\n\n')}

${relFields.join('\n\n')}
}`;

    return body;
  }
  // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
}
