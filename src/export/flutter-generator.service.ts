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

interface RelationInfo {
    fieldName: string;
    targetClass: string;
    type: 'ManyToOne' | 'OneToOne' | 'ManyToMany' | 'OneToMany';
    mappedBy?: string;
}

interface ClassMetadata {
    relations: RelationInfo[];
    isInheritanceChild: boolean;
    isInheritanceParent: boolean; // ✅ Agregado para filtrar padres abstractos
    parentClass?: string;
    isCompositionChild: boolean;
    compositionParent?: string;
    hasManyToMany: boolean;
}

@Injectable()
export class FlutterGeneratorService{
    async generateFromModel(
        model: DiagramModel,
        outputRoot?: string,
    ): Promise<void> {
        const baseFlutterPath = outputRoot || path.join(process.cwd(), 'flutter_app');

        //esructura de los directorios (MVVN)
        this.ensureDir(baseFlutterPath);
        this.ensureDir(path.join(baseFlutterPath, 'lib'));
        this.ensureDir(path.join(baseFlutterPath, 'lib', 'config'));
        this.ensureDir(path.join(baseFlutterPath,'lib', 'models'));
        this.ensureDir(path.join(baseFlutterPath,'lib', 'services'));
        this.ensureDir(path.join(baseFlutterPath,'lib', 'providers'));
        this.ensureDir(path.join(baseFlutterPath,'lib', 'screens'));
        this.ensureDir(path.join(baseFlutterPath,'lib', 'widgets'));

        const nodes = model.nodes || [];
        const edges = model.edges || [];

        //mapeo de nodos
        const nodeIdToClass: Record<string, string> = {};
        const attributesMap: Record<string, ModelNodeAttr[]> = {}

        for (const node of nodes) {
            const className = this.sanitizeClassName(node.data.label);
            nodeIdToClass[node.id] = className;
            attributesMap[className] = node.data.attributes || [];
        }

        const classMetaData = this.analyzeRelations(nodes, edges, nodeIdToClass, attributesMap)

        // generacion de archivos base
        this.generatePubspecYaml(baseFlutterPath);
        this.generateApiConfig(baseFlutterPath);
        this.generateApiService(baseFlutterPath);
        this.generateMultiSelectWidget(baseFlutterPath);
        this.generateMainDart(baseFlutterPath, nodes, nodeIdToClass);
        this.generateHomeScreen(baseFlutterPath, nodes, nodeIdToClass, classMetaData);

        for (const node of nodes) {
            const className = nodeIdToClass[node.id];
            const attributes = attributesMap[className] || [];
            const metadata = classMetaData[className];

            this.generateModel(baseFlutterPath, className, attributes, metadata, attributesMap);
            this.generateService(baseFlutterPath, className, metadata);
            this.generateProvider(baseFlutterPath, className);
            this.generateScreens(baseFlutterPath, className, attributes, metadata, attributesMap);
        }
    }

    private analyzeRelations(
        nodes: ModelNode[],
        edges: ModelEdge[],
        nodeIdToClass: Record<string, string>,
        attributesMap: Record<string, ModelNodeAttr[]>,
    ): Record<string, ClassMetadata> {
        const metadata: Record<string, ClassMetadata> = {};

        for (const node of nodes) {
            const className = nodeIdToClass[node.id];
            metadata[className] = {
                relations: [],
                isInheritanceChild: false,
                isInheritanceParent: false, // ✅ Inicializar en false
                isCompositionChild: false,
                hasManyToMany: false,
            };
        }

        const childToParent: Record<string, string> = {}; // herencia
        const compositionChildren: Record<string, string> = {}; // composicion
        const isMany = (card?: string) => !!card && card.includes('*');
        
        for(const edge of edges) {
            const edgeType = edge.data?.type || edge.type;
            const sourceClass = nodeIdToClass[edge.source];
            const targetClass = nodeIdToClass[edge.target];

            if(!sourceClass || !targetClass) continue;
            const sourceCard = edge.data?.sourceCardinality;
            const targetCard = edge.data?.targetCardinality;
            const sourceLower = sourceClass.charAt(0).toLocaleLowerCase() + sourceClass.slice(1);
            const targetLower = targetClass.charAt(0).toLowerCase() + targetClass.slice(1);
            
            //herencia
            if (edgeType === 'inheritance') {
                childToParent[targetClass] = sourceClass;
                metadata[targetClass].isInheritanceChild = true;
                metadata[targetClass].parentClass = sourceClass;
                metadata[sourceClass].isInheritanceParent = true; // ✅ Marcar padre
                continue;
            }

            //composicion
            if (edgeType === 'composition'){
                compositionChildren[targetClass] = sourceClass;
                metadata[targetClass].isCompositionChild = true;
                metadata[targetClass].compositionParent = sourceClass;
                
                //clase padre
                metadata[sourceClass].relations.push({
                    type: 'OneToMany',
                    fieldName: `${targetLower}s`,
                    targetClass: targetClass,
                    mappedBy: sourceLower,
                });
                // NO agregamos ManyToOne en el hijo porque ya se maneja con compositionParent
                // Esto evita duplicar el campo pedidoId
                continue;
            }

            //asociacion con intermedia
            const assocClassId = edge.data?.associationClass;
            if(edgeType === 'association' && assocClassId && nodeIdToClass[assocClassId]) {
                const assocClass = nodeIdToClass[assocClassId];

                metadata[assocClass].relations.push({
                    type: 'ManyToOne',
                    fieldName: sourceLower,
                    targetClass: sourceClass,
                });
                metadata[assocClass].relations.push({
                    type: 'ManyToOne',
                    fieldName: targetLower,
                    targetClass: targetClass
                })

                metadata[sourceClass].relations.push({
                    type: 'OneToMany',
                    fieldName: `${assocClass.charAt(0).toLowerCase() + assocClass.slice(1)}s`,
                    targetClass: assocClass,
                    mappedBy: sourceLower,
                });
                metadata[targetClass].relations.push({
                    type: 'OneToMany',
                    fieldName: `${assocClass.charAt(0).toLowerCase() + assocClass.slice(1)}s`,
                    targetClass: assocClass,
                    mappedBy: targetLower,
                });
                continue;
            }

            // muchos a muchos (sin clase intermedia)
            if (isMany(sourceCard) && isMany(targetCard)){
                metadata[sourceClass].hasManyToMany = true;
                metadata[sourceClass].relations.push({
                    type: 'ManyToMany',
                    fieldName: `${targetLower}s`,
                    targetClass: targetClass,
                });
                continue;
            }

            // uno a muchos / muchos a uno
            if(isMany(targetCard) && !isMany(sourceCard)){
                metadata[targetClass].relations.push({
                    type: 'ManyToOne',
                    fieldName: sourceLower,
                    targetClass: sourceClass,
                });
                metadata[sourceClass].relations.push({
                    type: 'OneToMany',
                    fieldName: `${targetLower}s`,
                    targetClass: targetClass,
                    mappedBy: sourceLower,
                });
                //muchos a uno / uno a muchos
            } else if (isMany(sourceCard) && !isMany(targetCard)) {
                metadata[sourceClass].relations.push({
                    type: 'ManyToOne',
                    fieldName: targetLower,
                    targetClass: targetClass,
                });
                metadata[targetClass].relations.push({
                    type: 'OneToMany',
                    fieldName: `${sourceLower}s`,
                    targetClass: sourceClass,
                    mappedBy: targetLower,
                });
            } else {
                //uno a uno
                // Usar el mismo cálculo que Spring: label o targetLower
                const fieldName = edge.data?.label 
                    ? this.sanitizeFieldName(edge.data.label)
                    : targetLower;
                    
                metadata[sourceClass].relations.push({
                    type: 'OneToOne',
                    fieldName: fieldName,
                    targetClass: targetClass,
                });
            }
        }
        return metadata;
    }

    //generador del .yaml
    private generatePubspecYaml(baseFlutterPath: string): void {
        const content = `name: flutter_app
description: A Flutter application generated from UML diagram
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  provider: ^6.1.1
  http: ^1.1.0
  intl: ^0.18.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0

flutter:
  uses-material-design: true
`;
        fs.writeFileSync(path.join(baseFlutterPath, 'pubspec.yaml'), content, 'utf8');
    }

    //generador del api config
    private generateApiConfig(baseFlutterPath: string): void {
        const content = `class ApiConfig {
  static const String baseUrl = 'http://localhost:8080/api';
  // Para Android Emulator: http://10.0.2.2:8080/api
  // Para dispositivo físico: http://TU_IP:8080/api
}
`;
        fs.writeFileSync(path.join(baseFlutterPath, 'lib', 'config', 'api_config.dart'),
        content,
        'utf8',
        );  
    }

    //generador del api service
    private generateApiService(baseFlutterPath: string): void {
        const content = `import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class ApiService {
  final String baseUrl = ApiConfig.baseUrl;

  Future<dynamic> get(String endpoint) async {
    try {
      final response = await http.get(
        Uri.parse('\$baseUrl/\$endpoint'),
        headers: {'Accept': 'application/json'},
      );
      
      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        throw Exception('Error: \${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Error de conexión: \$e');
    }
  }

  Future<dynamic> post(String endpoint, Map<String, dynamic> data) async {
    try {
      final response = await http.post(
        Uri.parse('\$baseUrl/\$endpoint'),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(data),
      );
      
      if (response.statusCode == 200 || response.statusCode == 201) {
        return json.decode(response.body);
      } else {
        throw Exception('Error: \${response.statusCode} - \${response.body}');
      }
    } catch (e) {
      throw Exception('Error de conexión: \$e');
    }
  }

  Future<dynamic> put(String endpoint, Map<String, dynamic> data) async {
    try {
      final response = await http.put(
        Uri.parse('\$baseUrl/\$endpoint'),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(data),
      );
      
      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        throw Exception('Error: \${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Error de conexión: \$e');
    }
  }

  Future<void> delete(String endpoint) async {
    try {
      final response = await http.delete(
        Uri.parse('\$baseUrl/\$endpoint'),
        headers: {'Accept': 'application/json'},
      );
      
      if (response.statusCode != 204 && response.statusCode != 200) {
        throw Exception('Error: \${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Error de conexión: \$e');
    }
  }
}
`;
    fs.writeFileSync(
      path.join(baseFlutterPath, 'lib', 'services', 'api_service.dart'),
      content,
      'utf8',
    );
  }
  //widget para seleccion multiple (para formularios con caso de muchos a muchos)
  private generateMultiSelectWidget(baseFlutterPath: string) : void {
    const content = `import 'package:flutter/material.dart';

class MultiSelectChip<T> extends StatefulWidget {
  final List<T> items;
  final List<T> selectedItems;
  final String Function(T) labelBuilder;
  final void Function(List<T>) onSelectionChanged;

  const MultiSelectChip({
    Key? key,
    required this.items,
    required this.selectedItems,
    required this.labelBuilder,
    required this.onSelectionChanged,
  }) : super(key: key);

  @override
  State<MultiSelectChip<T>> createState() => _MultiSelectChipState<T>();
}

class _MultiSelectChipState<T> extends State<MultiSelectChip<T>> {
  late List<T> _selectedItems;

  @override
  void initState() {
    super.initState();
    _selectedItems = List.from(widget.selectedItems);
  }

  void _toggleSelection(T item) {
    setState(() {
      if (_selectedItems.contains(item)) {
        _selectedItems.remove(item);
      } else {
        _selectedItems.add(item);
      }
      widget.onSelectionChanged(_selectedItems);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8.0,
      children: widget.items.map((item) {
        final isSelected = _selectedItems.contains(item);
        return FilterChip(
          label: Text(widget.labelBuilder(item)),
          selected: isSelected,
          onSelected: (_) => _toggleSelection(item),
          selectedColor: Theme.of(context).primaryColor.withOpacity(0.3),
        );
      }).toList(),
    );
  }
}
`;
    fs.writeFileSync(
        path.join(baseFlutterPath, 'lib', 'widgets', 'multi_select_chip.dart'),
        content,
        'utf8',
    );
  }

  //gnerador del main
  private generateMainDart(
    baseFlutterPath: string,
    nodes: ModelNode[],
    nodeIdToClass: Record<string, string>,
  ): void {
    const providers = nodes.map(node => {
        const className = nodeIdToClass[node.id];
        return `        ChangeNotifierProvider(create: (_) => ${className}Provider()),`;
    }).join('\n');

    const imports = nodes.map(node => {
        const className = nodeIdToClass[node.id];
        const lowerClass = className.charAt(0).toLocaleLowerCase() + className.slice(1);
        return `import 'providers/${lowerClass}_provider.dart';`;
    }).join('\n');

    const content = `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'screens/home_screen.dart';
${imports}

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
${providers}
      ],
      child: MaterialApp(
        title: 'Demo del generador flutter',
        theme: ThemeData(
          primarySwatch: Colors.blue,
          useMaterial3: true,
        ),
        home: const HomeScreen(),
      ),
    );
  }
}
`;

    fs.writeFileSync(path.join(baseFlutterPath, 'lib', 'main.dart'), content, 'utf8');
  }

  //generador de la home page
  private generateHomeScreen(
    baseFlutterPath: string,
    nodes: ModelNode[],
    nodeIdToClass: Record<string, string>,
    classMetadata: Record<string, ClassMetadata>,
  ): void {
    // CAMBIO: Mostrar TODAS las clases EXCEPTO padres de herencia
    // (los padres son abstractos y no se pueden instanciar directamente)
    const mainClasses = nodes.filter(node => {
      const className = nodeIdToClass[node.id];
      const meta = classMetadata[className];
      return !meta.isInheritanceParent; // ✅ Ocultar Vehiculo, mostrar Auto/Camion
    });

    const imports = mainClasses.map(node => {
        const className = nodeIdToClass[node.id];
        const lowerClass = className.charAt(0).toLowerCase() + className.slice(1);
        return `import '${lowerClass}/${lowerClass}_list_screen.dart';`;
    }).join('\n');

    const listTiles = mainClasses.map(node => {
        const className = nodeIdToClass[node.id];
        const lowerClass = className.charAt(0).toLowerCase() + className.slice(1);
        const meta = classMetadata[className];
        
        // Agregar indicador visual si es hijo o composición
        let icon = 'Icons.folder';
        let subtitle = '';
        if (meta.isInheritanceChild) {
          icon = 'Icons.subdirectory_arrow_right';
          subtitle = ` (Hereda de ${meta.parentClass})`;
        } else if (meta.isCompositionChild) {
          icon = 'Icons.arrow_forward';
          subtitle = ` (Parte de ${meta.compositionParent})`;
        }
        
        return `          ListTile(
            leading: const Icon(${icon}),
            title: Text('${className}s'),
            ${subtitle ? `subtitle: const Text('${subtitle}'),` : ''}
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const ${className}ListScreen()),
              );
            },
          ),`;
    }).join('\n');

    const content = `import 'package:flutter/material.dart';
${imports}

class HomeScreen extends StatelessWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sistema de Gestión'),
        elevation: 2,
      ),
      body: ListView(
        children: [
${listTiles}
        ],
      ),
    );
  }
}
`;
    fs.writeFileSync(
        path.join(baseFlutterPath, 'lib', 'screens', 'home_screen.dart'), 
        content,
        'utf8',
    );
  }
  
  private generateModel(
    baseFlutterPath: string,
    className: string,
    attributes: ModelNodeAttr[],
    metadata: ClassMetadata,
    attributesMap: Record<string, ModelNodeAttr[]>,
  ): void {
    const lowerClass = className.charAt(0).toLowerCase() + className.slice(1);

    //si es hijo de herencia pasa a incluir los atr del padre
    let allAttributes = [...attributes];
    if (metadata.isInheritanceChild && metadata.parentClass) {
        const parentAttrs = attributesMap[metadata.parentClass] || [];

        const childAttrsWithoutId = attributes.filter( a => a.name !== 'id');
        allAttributes = [...parentAttrs, ...childAttrsWithoutId];
    }

    const fields: string[] = [];

    //si composicion, se agrega un campo para el id del padre
    if (metadata.isCompositionChild && metadata.compositionParent) {
        const parentLower = metadata.compositionParent.charAt(0).toLowerCase() + metadata.compositionParent.slice(1);
        fields.push(`  int? ${parentLower}Id;`);
    }
    //tipado de atributos
    for (const attr of allAttributes) {
        const dartType = this.mapToDartType(attr.type);
        fields.push(`  ${dartType}? ${attr.name};`);
    }

    //campos de relaciones (solo los del form)
    const formRelations = metadata.relations.filter( r => r.type === 'ManyToOne' || r.type === 'OneToOne' || r.type === 'ManyToMany');

    for ( const rel of formRelations) {
        if (rel.type === 'ManyToMany') {
            fields.push(`  List<int>? ${rel.fieldName}Ids;`);
        } else {
            fields.push(`  int? ${rel.fieldName}Id;`);
        }
    }

    //constructor
    const constructorParams = [
        ...(metadata.isCompositionChild && metadata.compositionParent ? [`this.${metadata.compositionParent.charAt(0).toLowerCase() + metadata.compositionParent.slice(1)}Id`]
        : []),
        ...allAttributes.map(a => `this.${a.name}`),
        ...formRelations.map(r => r.type === 'ManyToMany' ? `this.${r.fieldName}Ids` : `this.${r.fieldName}Id`),
    ].join(', ');

    //from json
    const fromJsonLines: string[] = [];

    if (metadata.isCompositionChild && metadata.compositionParent) {
      const parentLower = metadata.compositionParent.charAt(0).toLowerCase() + metadata.compositionParent.slice(1);
      fromJsonLines.push(`      ${parentLower}Id: json['id'] is Map ? json['id']['${parentLower}Id'] : json['${parentLower}Id'],`);
    }
    for (const attr of allAttributes) {
      const dartType = this.mapToDartType(attr.type);
      if (attr.name === 'id' && metadata.isCompositionChild) {
        fromJsonLines.push(`      id: json['id'] is Map ? json['id']['id'] : json['id'],`);
      } else if (dartType === 'DateTime') {
        fromJsonLines.push(`      ${attr.name}: json['${attr.name}'] != null ? DateTime.parse(json['${attr.name}']) : null,`);
      } else {
        fromJsonLines.push(`      ${attr.name}: json['${attr.name}'],`);
      }
    }
    
    for (const rel of formRelations) {
      if (rel.type === 'ManyToMany') {
        fromJsonLines.push(`      ${rel.fieldName}Ids: (json['${rel.fieldName}'] as List?)?.map((e) => e['id'] as int).toList(),`);
      } else {
        fromJsonLines.push(`      ${rel.fieldName}Id: json['${rel.fieldName}'] != null ? json['${rel.fieldName}']['id'] : null,`);
      }
    }
    //to json
    const toJsonLines: string[] = [];

    if (metadata.isCompositionChild && metadata.compositionParent) {
        const parentLower = metadata.compositionParent.charAt(0).toLowerCase() + metadata.compositionParent.slice(1);
        // NO enviar campo 'id' completo - Spring genera @EmbeddedId automáticamente
        // Solo enviar la referencia al padre
        toJsonLines.push(`      '${parentLower}': {'id': ${parentLower}Id},`);
    }

    for (const attr of allAttributes) {
        if (attr.name === 'id' && !metadata.isCompositionChild) {
            continue; // para que nos solo se evie un id
        }
        if (attr.name === 'id' && metadata.isCompositionChild) {
            continue;
        }
        const dartType = this.mapToDartType(attr.type);
        if (dartType === 'DateTime') {
            toJsonLines.push(`      '${attr.name}': ${attr.name}?.toIso8601String(),`);
        } else {
            toJsonLines.push(`      '${attr.name}': ${attr.name},`);
        }
    }

    for (const rel of formRelations) {
      if (rel.type === 'ManyToMany') {
        toJsonLines.push(`      '${rel.fieldName}': ${rel.fieldName}Ids?.map((id) => {'id': id}).toList(),`);
      } else {
        toJsonLines.push(`      '${rel.fieldName}': ${rel.fieldName}Id != null ? {'id': ${rel.fieldName}Id} : null,`);
      }
    }

    const content = `class ${className} {
${fields.join('\n')}

  ${className}({${constructorParams}});

  factory ${className}.fromJson(Map<String, dynamic> json) {
    return ${className}(
${fromJsonLines.join('\n')}
    );
  }

  Map<String, dynamic> toJson() {
    return {
${toJsonLines.join('\n')}
    };
  }
}
`;
    fs.writeFileSync(
        path.join(baseFlutterPath, 'lib', 'models', `${lowerClass}.dart`),
        content,
        'utf8',
    );
  }

  private generateService(
    baseFlutterPath: string,
    className: string,
    metadata: ClassMetadata,
  ): void {
    const lowerClass = className.charAt(0).toLowerCase() + className.slice(1);

    // ✅ Las clases de herencia usan su PROPIO endpoint, no subrutas del padre
    const endpoint = lowerClass; // Siempre /api/auto, /api/camion, etc.
    
    const content = `import '../models/${lowerClass}.dart';
import 'api_service.dart';

class ${className}Service {
  final ApiService _apiService = ApiService();
  final String endpoint = '${endpoint}';

  Future<List<${className}>> getAll() async {
    final data = await _apiService.get(endpoint);
    return (data as List).map((json) => ${className}.fromJson(json)).toList();
  }

  Future<${className}> getById(${metadata.isCompositionChild ? 'Map<String, dynamic>' : 'int'} id) async {
    ${metadata.isCompositionChild
      ? `final idStr = '\${id["${metadata.compositionParent!.charAt(0).toLowerCase() + metadata.compositionParent!.slice(1)}Id"]},\${id["id"]}';
    final data = await _apiService.get('\$endpoint/\$idStr');`
      : `final data = await _apiService.get('\$endpoint/\$id');`
    }
    return ${className}.fromJson(data);
  }

  Future<${className}> create(${className} entity) async {
    final data = await _apiService.post(endpoint, entity.toJson());
    return ${className}.fromJson(data);
  }

  Future<${className}> update(${metadata.isCompositionChild ? 'Map<String, dynamic>' : 'int'} id, ${className} entity) async {
    ${metadata.isCompositionChild
      ? `final idStr = '\${id["${metadata.compositionParent!.charAt(0).toLowerCase() + metadata.compositionParent!.slice(1)}Id"]},\${id["id"]}';
    final data = await _apiService.put('\$endpoint/\$idStr', entity.toJson());`
      : `final data = await _apiService.put('\$endpoint/\$id', entity.toJson());`
    }
    return ${className}.fromJson(data);
  }

  Future<void> delete(${metadata.isCompositionChild ? 'Map<String, dynamic>' : 'int'} id) async {
    ${metadata.isCompositionChild
      ? `final idStr = '\${id["${metadata.compositionParent!.charAt(0).toLowerCase() + metadata.compositionParent!.slice(1)}Id"]},\${id["id"]}';
    await _apiService.delete('\$endpoint/\$idStr');`
      : `await _apiService.delete('\$endpoint/\$id');`
    }
  }
}
`;
    fs.writeFileSync(
        path.join(baseFlutterPath, 'lib', 'services', `${lowerClass}_service.dart`),
        content,
        'utf8',
    );
  }

  private generateProvider(baseFlutterPath: string, className: string): void {
    const lowerClass = className.charAt(0).toLowerCase() + className.slice(1);

    const content = `import 'package:flutter/material.dart';
import '../models/${lowerClass}.dart';
import '../services/${lowerClass}_service.dart';

class ${className}Provider with ChangeNotifier {
  final ${className}Service _service = ${className}Service();
  
  List<${className}> _items = [];
  bool _isLoading = false;
  String? _errorMessage;

  List<${className}> get items => _items;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  Future<void> fetchAll() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      _items = await _service.getAll();
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<${className}?> fetchById(dynamic id) async {
    try {
      return await _service.getById(id);
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<bool> create(${className} entity) async {
    try {
      final created = await _service.create(entity);
      _items.add(created);
      notifyListeners();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> update(dynamic id, ${className} entity) async {
    try {
      await _service.update(id, entity);
      await fetchAll(); // Recargar lista
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> delete(dynamic id) async {
    try {
      await _service.delete(id);
      await fetchAll(); // Recargar lista
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }
}
`;
    fs.writeFileSync(
        path.join(baseFlutterPath, 'lib', 'providers', `${lowerClass}_provider.dart`),
        content,
        'utf8',
    );
  }

  private generateScreens(
    baseFlutterPath: string,
    className: string,
    attributes: ModelNodeAttr[],
    metadata: ClassMetadata,
    attributesMap: Record<string, ModelNodeAttr[]>,
  ): void {
    const lowerClass = className.charAt(0).toLowerCase() + className.slice(1);
    const screenDir = path.join(baseFlutterPath, 'lib', 'screens', lowerClass);
    this.ensureDir(screenDir);

    this.generateListScreen(screenDir, className, lowerClass, metadata);
    this.generateDetailScreen(screenDir, className, lowerClass, attributes, metadata, attributesMap);
    this.generateFormScreen(screenDir, className, lowerClass, attributes, metadata, attributesMap);
  }

  private generateListScreen(
    screenDir: string,
    className: string,
    lowerClass: string,
    metadata: ClassMetadata,
  ): void {
    const idAccessor = metadata.isCompositionChild
        ? `{"${metadata.compositionParent!.charAt(0).toLowerCase() + metadata.compositionParent!.slice(1)}Id": item.${metadata.compositionParent!.charAt(0).toLowerCase() + metadata.compositionParent!.slice(1)}Id, "id": item.id}`
        : 'item.id!';

    const content = `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/${lowerClass}_provider.dart';
import '${lowerClass}_detail_screen.dart';
import '${lowerClass}_form_screen.dart';

class ${className}ListScreen extends StatefulWidget {
  const ${className}ListScreen({Key? key}) : super(key: key);

  @override
  State<${className}ListScreen> createState() => _${className}ListScreenState();
}

class _${className}ListScreenState extends State<${className}ListScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<${className}Provider>().fetchAll());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('${className}s'),
      ),
      body: Consumer<${className}Provider>(
        builder: (context, provider, child) {
          if (provider.isLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (provider.errorMessage != null) {
            return Center(child: Text('Error: \${provider.errorMessage}'));
          }

          if (provider.items.isEmpty) {
            return const Center(child: Text('No hay registros'));
          }

          return ListView.builder(
            itemCount: provider.items.length,
            itemBuilder: (context, index) {
              final item = provider.items[index];
              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: ListTile(
                  title: Text('${className} #\${item.id}'),
                  subtitle: Text('ID: \${item.id}'),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete, color: Colors.red),
                    onPressed: () async {
                      final confirm = await showDialog<bool>(
                        context: context,
                        builder: (context) => AlertDialog(
                          title: const Text('Confirmar'),
                          content: const Text('¿Eliminar este registro?'),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(context, false),
                              child: const Text('Cancelar'),
                            ),
                            TextButton(
                              onPressed: () => Navigator.pop(context, true),
                              child: const Text('Eliminar'),
                            ),
                          ],
                        ),
                      );

                      if (confirm == true) {
                        await provider.delete(${idAccessor});
                      }
                    },
                  ),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => ${className}DetailScreen(id: ${idAccessor}),
                      ),
                    );
                  },
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const ${className}FormScreen()),
          );
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}
`;
    fs.writeFileSync(
        path.join(screenDir, `${lowerClass}_list_screen.dart` ),
        content,
        'utf8',
    );
  }

  private generateDetailScreen(
    screenDir: string,
    className: string,
    lowerClass: string,
    attributes: ModelNodeAttr[],
    metadata: ClassMetadata,
    attributesMap: Record<string, ModelNodeAttr[]>,
  ): void {
    //si es herencia, incluir atr del padre
    let allAttributes = [...attributes];
    if (metadata.isInheritanceChild && metadata.parentClass) {
        const parentAttrs = attributesMap[metadata.parentClass] || [];
        const childAttrsWithoutId = attributes.filter(a => a.name !== 'id');
        allAttributes = [...parentAttrs, ...childAttrsWithoutId];
    }

    const attributeWidgets = allAttributes
        .map(attr => `            Text('${attr.name}: \${${lowerClass}.${attr.name} ?? "N/A"}', style: const TextStyle(fontSize: 16)),`)
        .join('\n');
    
    const content = `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/${lowerClass}_provider.dart';
import '../../models/${lowerClass}.dart';
import '${lowerClass}_form_screen.dart';

class ${className}DetailScreen extends StatelessWidget {
  final dynamic id;

  const ${className}DetailScreen({Key? key, required this.id}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Detalle de ${className}'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: () async {
              final provider = context.read<${className}Provider>();
              final entity = await provider.fetchById(id);
              if (entity != null) {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ${className}FormScreen(entity: entity),
                  ),
                );
              }
            },
          ),
        ],
      ),
      body: FutureBuilder<${className}?>(
        future: context.read<${className}Provider>().fetchById(id),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return Center(child: Text('Error: \${snapshot.error}'));
          }

          final ${lowerClass} = snapshot.data;
          if (${lowerClass} == null) {
            return const Center(child: Text('No se encontró el registro'));
          }

          return Padding(
            padding: const EdgeInsets.all(16.0),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
${attributeWidgets}
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
`;
    fs.writeFileSync(
        path.join(screenDir, `${lowerClass}_detail_screen.dart`),
        content,
        'utf8',
    );
  }
  //form "inteligente"
  private generateFormScreen(
    screenDir: string,
    className: string,
    lowerClass: string,
    attributes: ModelNodeAttr[],
    metadata: ClassMetadata,
    attributesMap: Record<string, ModelNodeAttr[]>
  ): void {
    //incluir atr del padre si es herencia
    let allAttributes = [...attributes];
    if (metadata.isInheritanceChild && metadata.parentClass) {
      const parentAttrs = attributesMap[metadata.parentClass] || [];
      const childAttrsWithoutId = attributes.filter(a => a.name !== 'id');
      allAttributes = [...parentAttrs, ...childAttrsWithoutId];
    }

    //controllers
    const controllers = allAttributes
      .filter(attr => attr.name !== 'id' || metadata.isCompositionChild)
      .map(attr => `  final ${attr.name}Controller = TextEditingController();`)
      .join('\n');

    const disposeControllers = allAttributes
      .filter(attr => attr.name !== 'id' || metadata.isCompositionChild)
      .map(attr => `    ${attr.name}Controller.dispose();`)
      .join('\n');

    //relaciones para el form
    const formRelations = metadata.relations.filter(r => 
      r.type === 'ManyToOne' || r.type === 'OneToOne' || r.type === 'ManyToMany'
    );

    // Si es composición, agregar el provider del padre
    const relationProviders = [...new Set(formRelations.map(r => r.targetClass))];
    if (metadata.isCompositionChild && metadata.compositionParent) {
      if (!relationProviders.includes(metadata.compositionParent)) {
        relationProviders.push(metadata.compositionParent);
      }
    }

    const relationImports = relationProviders
      .map(cls => {
        const lower = cls.charAt(0).toLowerCase() + cls.slice(1);
        return `import '../../providers/${lower}_provider.dart';`;
      })
      .join('\n');

    // Variables de estado para relaciones + composición
    const relationStateVars = [
      ...formRelations.map(rel => {
        if (rel.type === 'ManyToMany') {
          return `  List<int> selected${rel.targetClass}Ids = [];`;
        }
        return `  int? selected${rel.targetClass}Id;`;
      }),
      // Si es composición, agregar variable para el padre
      ...(metadata.isCompositionChild && metadata.compositionParent
        ? [`  int? selected${metadata.compositionParent}Id;`]
        : []),
    ].join('\n');

    const relationFetches = relationProviders
      .map(cls => {
        const lower = cls.charAt(0).toLowerCase() + cls.slice(1);
        return `      context.read<${cls}Provider>().fetchAll();`;
      })
      .join('\n');

    const initControllers = allAttributes
      .filter(attr => attr.name !== 'id' || metadata.isCompositionChild)
      .map(attr => {
        const dartType = this.mapToDartType(attr.type);
        if (dartType === 'DateTime') {
          return `      ${attr.name}Controller.text = widget.entity?.${attr.name}?.toIso8601String().split('T')[0] ?? '';`;
        }
        return `      ${attr.name}Controller.text = widget.entity?.${attr.name}?.toString() ?? '';`;
      })
      .join('\n');
    
    const initRelations = [
      ...formRelations.map(rel => {
        if (rel.type === 'ManyToMany') {
          return `      selected${rel.targetClass}Ids = widget.entity?.${rel.fieldName}Ids ?? [];`;
        }
        return `      selected${rel.targetClass}Id = widget.entity?.${rel.fieldName}Id;`;
      }),
      // Si es composición, inicializar el selectedParentId
      ...(metadata.isCompositionChild && metadata.compositionParent
        ? [
            `      selected${metadata.compositionParent}Id = widget.entity?.${metadata.compositionParent.charAt(0).toLowerCase() + metadata.compositionParent.slice(1)}Id;`,
          ]
        : []),
    ].join('\n');

    //campos del form
    const formFields = allAttributes
      .filter(attr => attr.name !== 'id') // NUNCA mostrar campo 'id' en formularios (es autogenerado)
      .map(attr => {
        const dartType = this.mapToDartType(attr.type);
        let keyboardType = 'TextInputType.text';
        let hintText = '';
        
        if (dartType === 'int' || dartType === 'double') {
          keyboardType = 'TextInputType.number';
        } else if (dartType === 'DateTime') {
          keyboardType = 'TextInputType.datetime';
          hintText = '2025-11-09'; // Ejemplo de formato para fechas
        }

        return `              TextFormField(
                controller: ${attr.name}Controller,
                decoration: const InputDecoration(
                  labelText: '${attr.name}',
                  ${hintText ? `hintText: '${hintText}',` : ''}
                  border: OutlineInputBorder(),
                ),
                keyboardType: ${keyboardType},
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Campo requerido';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),`;
      })
      .join('\n');

    // Dropdown del padre para composición (debe ir primero)
    const compositionParentWidget = metadata.isCompositionChild && metadata.compositionParent
      ? `              Consumer<${metadata.compositionParent}Provider>(
                builder: (context, provider, child) {
                  return DropdownButtonFormField<int>(
                    value: selected${metadata.compositionParent}Id,
                    decoration: const InputDecoration(
                      labelText: '${metadata.compositionParent.charAt(0).toLowerCase() + metadata.compositionParent.slice(1)}',
                      border: OutlineInputBorder(),
                    ),
                    items: provider.items.map((item) {
                      return DropdownMenuItem<int>(
                        value: item.id,
                        child: Text('${metadata.compositionParent} #\${item.id}'),
                      );
                    }).toList(),
                    onChanged: (value) {
                      setState(() {
                        selected${metadata.compositionParent}Id = value;
                      });
                    },
                    validator: (value) {
                      if (value == null) {
                        return 'Debe seleccionar un ${metadata.compositionParent}';
                      }
                      return null;
                    },
                  );
                },
              ),
              const SizedBox(height: 16),`
      : '';

      const relationWidgets = formRelations
        .map(rel => {
            if (rel.type === 'ManyToMany') {
                const lower = rel.targetClass.charAt(0).toLowerCase() + rel.targetClass.slice(1);
                return `              Consumer<${rel.targetClass}Provider>(
                builder: (context, provider, child) {
                  if (provider.items.isEmpty) {
                    return const Text('Cargando ${rel.targetClass}s...');
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('${rel.targetClass}s:', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        children: provider.items.map((item) {
                          final isSelected = selected${rel.targetClass}Ids.contains(item.id);
                          return FilterChip(
                            label: Text('${rel.targetClass} #\${item.id}'),
                            selected: isSelected,
                            onSelected: (selected) {
                              setState(() {
                                if (selected) {
                                  selected${rel.targetClass}Ids.add(item.id!);
                                } else {
                                  selected${rel.targetClass}Ids.remove(item.id);
                                }
                              });
                            },
                          );
                        }).toList(),
                      ),
                    ],
                  );
                },
              ),
              const SizedBox(height: 16),`;
            } else {
                return `              Consumer<${rel.targetClass}Provider>(
                builder: (context, provider, child) {
                  return DropdownButtonFormField<int>(
                    value: selected${rel.targetClass}Id,
                    decoration: const InputDecoration(
                      labelText: '${rel.fieldName}',
                      border: OutlineInputBorder(),
                    ),
                    items: provider.items.map((item) {
                      return DropdownMenuItem<int>(
                        value: item.id,
                        child: Text('${rel.targetClass} #\${item.id}'),
                      );
                    }).toList(),
                    onChanged: (value) {
                      setState(() {
                        selected${rel.targetClass}Id = value;
                      });
                    },
                  );
                },
              ),
              const SizedBox(height: 16),`;
            }
        }).join('\n');

        const createEntity = this.buildCreateEntityCode(
            className,
            allAttributes,
            formRelations,
            metadata,
        );

        const content = `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/${lowerClass}_provider.dart';
import '../../models/${lowerClass}.dart';
${relationImports}

class ${className}FormScreen extends StatefulWidget {
  final ${className}? entity;

  const ${className}FormScreen({Key? key, this.entity}) : super(key: key);

  @override
  State<${className}FormScreen> createState() => _${className}FormScreenState();
}

class _${className}FormScreenState extends State<${className}FormScreen> {
  final _formKey = GlobalKey<FormState>();
${controllers}
${relationStateVars}

  @override
  void initState() {
    super.initState();
    
    Future.microtask(() {
${relationFetches}
    });

    if (widget.entity != null) {
${initControllers}
${initRelations}
    }
  }

  @override
  void dispose() {
${disposeControllers}
    super.dispose();
  }

  Future<void> _submit() async {
    if (_formKey.currentState!.validate()) {
${createEntity}

      final provider = context.read<${className}Provider>();
      bool success;

      if (widget.entity != null && widget.entity!.id != null) {
        ${metadata.isCompositionChild
          ? `final id = {
          "${metadata.compositionParent!.charAt(0).toLowerCase() + metadata.compositionParent!.slice(1)}Id": widget.entity!.${metadata.compositionParent!.charAt(0).toLowerCase() + metadata.compositionParent!.slice(1)}Id,
          "id": widget.entity!.id,
        };
        success = await provider.update(id, entity);`
          : `success = await provider.update(widget.entity!.id!, entity);`
        }
      } else {
        success = await provider.create(entity);
      }

      if (success && mounted) {
        Navigator.pop(context);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(provider.errorMessage ?? 'Error desconocido')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.entity == null ? 'Crear ${className}' : 'Editar ${className}'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: ListView(
            children: [
${compositionParentWidget}
${formFields}
${relationWidgets}
              ElevatedButton.icon(
                onPressed: _submit,
                icon: const Icon(Icons.save),
                label: Text(widget.entity == null ? 'Crear' : 'Actualizar'),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size.fromHeight(50),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
`;
    fs.writeFileSync(
        path.join(screenDir, `${lowerClass}_form_screen.dart`),
        content,
        'utf8',
    );
  }
  private buildCreateEntityCode(
    className: string,
    allAttributes: ModelNodeAttr[],
    formRelations: RelationInfo[],
    metadata: ClassMetadata,
  ): string {
    const lines: string[] = [`      final entity = ${className}(`];
    
    //si composicion, se agrega el id del padre
    if (metadata.isCompositionChild && metadata.compositionParent) {
      const parentLower = metadata.compositionParent.charAt(0).toLowerCase() + metadata.compositionParent.slice(1);
      lines.push(`        ${parentLower}Id: selected${metadata.compositionParent}Id,`);
    }
    for (const attr of allAttributes) {
      if (attr.name === 'id') {
        continue; // NUNCA incluir 'id' en constructor (es autogenerado)
      }
      const dartType = this.mapToDartType(attr.type);
      if (dartType === 'int') {
        lines.push(`        ${attr.name}: int.tryParse(${attr.name}Controller.text),`);
      } else if (dartType === 'double') {
        lines.push(`        ${attr.name}: double.tryParse(${attr.name}Controller.text),`);
      } else if (dartType === 'bool') {
        lines.push(`        ${attr.name}: ${attr.name}Controller.text.toLowerCase() == 'true',`);
      } else if (dartType === 'DateTime') {
        lines.push(`        ${attr.name}: DateTime.tryParse(${attr.name}Controller.text),`);
      } else {
        lines.push(`        ${attr.name}: ${attr.name}Controller.text,`);
      }
    }

    for (const rel of formRelations) {
        if (rel.type === 'ManyToMany') {
        lines.push(`        ${rel.fieldName}Ids: selected${rel.targetClass}Ids,`);
      } else {
        // ManyToOne y OneToOne: ambos usan fieldNameId
        // toJson() se encarga de convertir a objeto nested si es necesario
        lines.push(`        ${rel.fieldName}Id: selected${rel.targetClass}Id,`);
      }
    }
    lines.push(`      );`);
    return lines.join('\n');
  }

    private mapToDartType(attrType: string): string {
        switch ((attrType || '').toLowerCase()) {
        case 'int':
        case 'integer':
        case 'long':
            return 'int';
        case 'double':
        case 'float':
        case 'bigdecimal':
        case 'decimal':
            return 'double';
        case 'boolean':
        case 'bool':
            return 'bool';
        case 'date':
        case 'localdate':
        case 'localdatetime':
        case 'datetime':
            return 'DateTime';
        case 'string':
        case 'text':
        default:
            return 'String';
        }
    }

    private sanitizeClassName(label: string): string {
        return label
        .replace(/[^a-zA-Z0-9]/g, '')
        .replace(/^(.)/, (c) => c.toUpperCase());
    }

    private sanitizeFieldName(label: string): string {
        return label
        .replace(/[^a-zA-Z0-9]/g, '')
        .replace(/^(.)/, (c) => c.toLowerCase());
    }

    private ensureDir(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}