import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed: Spring Boot Generator Complete Test...');

  // Limpiar datos existentes
  await prisma.diagramMember.deleteMany();
  await prisma.diagramInvite.deleteMany();
  await prisma.diagram.deleteMany();
  await prisma.user.deleteMany();

  // Crear usuario de prueba con password real hasheado
  const password = 'Test1234'; // Password: Test1234
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const testUser = await prisma.user.create({
    data: {
      email: 'spring-test@test.com',
      username: 'springtester',
      password: hashedPassword,
      isActive: true,
    },
  });

  console.log('✅ Usuario de prueba creado:', testUser.email);
  console.log('🔑 Credenciales:');
  console.log('   Email:', testUser.email);
  console.log('   Password: Test1234');

  // Diagrama de prueba COMPLETO con TODAS las características
  const testDiagram = await prisma.diagram.create({
    data: {
      name: 'Spring Generator Complete Test',
      description: 'Diagrama que prueba TODAS las características: herencia, composición, asociación con clase, OneToMany, ManyToMany, OneToOne, y tipos variados',
      ownerId: testUser.id,
      model: {
        nodes: [
          // ============================================
          // 1. HERENCIA: Vehículo (padre) → Auto, Camión (hijos)
          // ============================================
          {
            id: 'vehiculo-1',
            type: 'classNode',
            position: { x: 100, y: 50 },
            data: {
              label: 'Vehiculo',
              attributes: [
                { id: 'v1', name: 'id', type: 'Long' },
                { id: 'v2', name: 'marca', type: 'String' },
                { id: 'v3', name: 'modelo', type: 'String' },
                { id: 'v4', name: 'anio', type: 'Integer' },
                { id: 'v5', name: 'precio', type: 'BigDecimal' },
                { id: 'v6', name: 'fechaFabricacion', type: 'LocalDate' },
              ],
            },
          },
          {
            id: 'auto-1',
            type: 'classNode',
            position: { x: 50, y: 250 },
            data: {
              label: 'Auto',
              attributes: [
                { id: 'a1', name: 'numeroPuertas', type: 'Integer' },
                { id: 'a2', name: 'tieneAireAcondicionado', type: 'Boolean' },
              ],
            },
          },
          {
            id: 'camion-1',
            type: 'classNode',
            position: { x: 250, y: 250 },
            data: {
              label: 'Camion',
              attributes: [
                { id: 'c1', name: 'capacidadCarga', type: 'Double' },
                { id: 'c2', name: 'numeroEjes', type: 'Integer' },
              ],
            },
          },

          // ============================================
          // 2. COMPOSICIÓN: Pedido → ItemPedido (PK compuesta)
          // ============================================
          {
            id: 'pedido-1',
            type: 'classNode',
            position: { x: 500, y: 50 },
            data: {
              label: 'Pedido',
              attributes: [
                { id: 'p1', name: 'id', type: 'Long' },
                { id: 'p2', name: 'numeroPedido', type: 'String' },
                { id: 'p3', name: 'fechaPedido', type: 'LocalDateTime' },
                { id: 'p4', name: 'total', type: 'BigDecimal' },
              ],
            },
          },
          {
            id: 'itempedido-1',
            type: 'classNode',
            position: { x: 500, y: 250 },
            data: {
              label: 'ItemPedido',
              attributes: [
                { id: 'ip1', name: 'id', type: 'Long' },
                { id: 'ip2', name: 'cantidad', type: 'Integer' },
                { id: 'ip3', name: 'precioUnitario', type: 'BigDecimal' },
              ],
            },
          },

          // ============================================
          // 3. ASOCIACIÓN CON CLASE: Estudiante ↔ Curso (con Inscripcion)
          // ============================================
          {
            id: 'estudiante-1',
            type: 'classNode',
            position: { x: 800, y: 50 },
            data: {
              label: 'Estudiante',
              attributes: [
                { id: 'e1', name: 'id', type: 'Long' },
                { id: 'e2', name: 'nombre', type: 'String' },
                { id: 'e3', name: 'matricula', type: 'String' },
                { id: 'e4', name: 'fechaNacimiento', type: 'Date' },
              ],
            },
          },
          {
            id: 'curso-1',
            type: 'classNode',
            position: { x: 1100, y: 50 },
            data: {
              label: 'Curso',
              attributes: [
                { id: 'cu1', name: 'id', type: 'Long' },
                { id: 'cu2', name: 'nombre', type: 'String' },
                { id: 'cu3', name: 'creditos', type: 'Integer' },
              ],
            },
          },
          {
            id: 'inscripcion-1',
            type: 'classNode',
            position: { x: 950, y: 250 },
            data: {
              label: 'Inscripcion',
              attributes: [
                { id: 'i1', name: 'id', type: 'Long' },
                { id: 'i2', name: 'fechaInscripcion', type: 'LocalDate' },
                { id: 'i3', name: 'nota', type: 'Double' },
                { id: 'i4', name: 'aprobado', type: 'Boolean' },
              ],
            },
          },

          // ============================================
          // 4. ONE TO MANY / MANY TO ONE: Cliente → Factura
          // ============================================
          {
            id: 'cliente-1',
            type: 'classNode',
            position: { x: 100, y: 450 },
            data: {
              label: 'Cliente',
              attributes: [
                { id: 'cl1', name: 'id', type: 'Long' },
                { id: 'cl2', name: 'nombre', type: 'String' },
                { id: 'cl3', name: 'email', type: 'String' },
                { id: 'cl4', name: 'activo', type: 'Boolean' },
              ],
            },
          },
          {
            id: 'factura-1',
            type: 'classNode',
            position: { x: 100, y: 650 },
            data: {
              label: 'Factura',
              attributes: [
                { id: 'f1', name: 'id', type: 'Long' },
                { id: 'f2', name: 'numeroFactura', type: 'String' },
                { id: 'f3', name: 'fechaEmision', type: 'LocalDate' },
                { id: 'f4', name: 'monto', type: 'BigDecimal' },
              ],
            },
          },

          // ============================================
          // 5. MANY TO MANY: Producto ↔ Categoria
          // ============================================
          {
            id: 'producto-1',
            type: 'classNode',
            position: { x: 500, y: 450 },
            data: {
              label: 'Producto',
              attributes: [
                { id: 'pr1', name: 'id', type: 'Long' },
                { id: 'pr2', name: 'nombre', type: 'String' },
                { id: 'pr3', name: 'precio', type: 'BigDecimal' },
                { id: 'pr4', name: 'stock', type: 'Integer' },
              ],
            },
          },
          {
            id: 'categoria-1',
            type: 'classNode',
            position: { x: 500, y: 650 },
            data: {
              label: 'Categoria',
              attributes: [
                { id: 'cat1', name: 'id', type: 'Long' },
                { id: 'cat2', name: 'nombre', type: 'String' },
                { id: 'cat3', name: 'descripcion', type: 'String' },
              ],
            },
          },

          // ============================================
          // 6. ONE TO ONE: Empleado ↔ DetalleEmpleado
          // ============================================
          {
            id: 'empleado-1',
            type: 'classNode',
            position: { x: 800, y: 450 },
            data: {
              label: 'Empleado',
              attributes: [
                { id: 'em1', name: 'id', type: 'Long' },
                { id: 'em2', name: 'nombre', type: 'String' },
                { id: 'em3', name: 'cargo', type: 'String' },
                { id: 'em4', name: 'fechaContratacion', type: 'LocalDate' },
              ],
            },
          },
          {
            id: 'detalleempleado-1',
            type: 'classNode',
            position: { x: 800, y: 650 },
            data: {
              label: 'DetalleEmpleado',
              attributes: [
                { id: 'de1', name: 'id', type: 'Long' },
                { id: 'de2', name: 'numeroSeguroSocial', type: 'String' },
                { id: 'de3', name: 'salario', type: 'BigDecimal' },
                { id: 'de4', name: 'activo', type: 'Boolean' },
              ],
            },
          },
        ],
        edges: [
          // ============================================
          // HERENCIA: Vehiculo → Auto, Camión
          // ============================================
          {
            id: 'e1-vehiculo-auto',
            source: 'vehiculo-1',
            target: 'auto-1',
            type: 'inheritance',
            data: { type: 'inheritance' },
          },
          {
            id: 'e2-vehiculo-camion',
            source: 'vehiculo-1',
            target: 'camion-1',
            type: 'inheritance',
            data: { type: 'inheritance' },
          },

          // ============================================
          // COMPOSICIÓN: Pedido → ItemPedido
          // ============================================
          {
            id: 'e3-pedido-item',
            source: 'pedido-1',
            target: 'itempedido-1',
            type: 'composition',
            data: {
              type: 'composition',
              sourceCardinality: '1',
              targetCardinality: '0..*',
            },
          },

          // ============================================
          // ASOCIACIÓN CON CLASE: Estudiante ↔ Curso (Inscripcion)
          // ============================================
          {
            id: 'e4-estudiante-curso',
            source: 'estudiante-1',
            target: 'curso-1',
            type: 'association',
            data: {
              type: 'association',
              sourceCardinality: '0..*',
              targetCardinality: '0..*',
              associationClass: 'inscripcion-1',
            },
          },

          // ============================================
          // ONE TO MANY: Cliente → Factura (con label "facturas")
          // ============================================
          {
            id: 'e5-cliente-factura',
            source: 'cliente-1',
            target: 'factura-1',
            type: 'association',
            data: {
              type: 'association',
              label: 'facturas',
              sourceCardinality: '1',
              targetCardinality: '0..*',
            },
          },

          // ============================================
          // MANY TO MANY: Producto ↔ Categoria
          // ============================================
          {
            id: 'e6-producto-categoria',
            source: 'producto-1',
            target: 'categoria-1',
            type: 'association',
            data: {
              type: 'association',
              sourceCardinality: '0..*',
              targetCardinality: '0..*',
            },
          },

          // ============================================
          // ONE TO ONE: Empleado ↔ DetalleEmpleado (con label "detalle")
          // ============================================
          {
            id: 'e7-empleado-detalle',
            source: 'empleado-1',
            target: 'detalleempleado-1',
            type: 'association',
            data: {
              type: 'association',
              label: 'detalle',
              sourceCardinality: '1',
              targetCardinality: '0..1',
            },
          },
        ],
      },
      isActive: true,
    },
  });

  console.log('✅ Diagrama de prueba completo creado:', testDiagram.name);
  console.log('📊 ID del diagrama:', testDiagram.id);

  console.log('\n🎯 CARACTERÍSTICAS PROBADAS:');
  console.log('  1. ✅ HERENCIA (JOINED): Vehiculo → Auto, Camion');
  console.log('  2. ✅ COMPOSICIÓN (PK compuesta): Pedido → ItemPedido');
  console.log('  3. ✅ ASOCIACIÓN CON CLASE: Estudiante ↔ Curso (Inscripcion)');
  console.log('  4. ✅ ONE TO MANY con label: Cliente → Factura');
  console.log('  5. ✅ MANY TO MANY: Producto ↔ Categoria');
  console.log('  6. ✅ ONE TO ONE con label: Empleado ↔ DetalleEmpleado');
  console.log('  7. ✅ TIPOS VARIADOS: String, Integer, Long, Double, Boolean, BigDecimal, Date, LocalDate, LocalDateTime');

  console.log('\n📝 CREDENCIALES PARA LOGIN:');
  console.log('  Email: spring-test@test.com');
  console.log('  Password: Test1234');

  console.log('\n📝 PRÓXIMOS PASOS:');
  console.log('  1. Hacer login desde el frontend con las credenciales de arriba');
  console.log(`  2. Buscar el diagrama: "${testDiagram.name}"`);
  console.log(`     (ID: ${testDiagram.id})`);
  console.log('  3. Exportar a Spring Boot desde el frontend');
  console.log('  4. Descomprimir el ZIP generado');
  console.log('  5. cd [carpeta-descomprimida] && .\\mvnw.cmd clean install');
  console.log('  6. .\\mvnw.cmd spring-boot:run');
  console.log('  7. Probar endpoints: http://localhost:8080/api/vehiculo, /api/pedido, etc.');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
