# Estándares de codificación (resumen)

Breve listado de los estándares detectados en el proyecto.

- Linter: ESLint con @eslint/js y `typescript-eslint` (configuración en `eslint.config.mjs`).
- Formateo: Prettier (script `npm run format`) integrado via `eslint-plugin-prettier`.
- TypeScript (archivo `tsconfig.json`):
  - module: `nodenext` / moduleResolution: `nodenext`.
  - target: `ES2023`.
  - `experimentalDecorators` y `emitDecoratorMetadata` habilitados (NestJS).
  - `strictNullChecks: true`, `noImplicitAny: false` (no estricto completo).
  - `declaration: true`, `skipLibCheck: true`.
- Arquitectura: NestJS (módulos, controladores, servicios, guards, strategies).
- Convenciones de nombres:
  - Modelos Prisma: PascalCase (ej. `User`, `Diagram`).
  - Enums en Prisma: MAYÚSCULAS.
  - Carpetas de módulos: mezcla de `kebab-case` y `snake_case` (p. ej. `diagram-socket`, `diagram_members`).
  - Clases y DTOs: PascalCase; tipos exportados con `type` usan camelCase en algunos casos (hay inconsistencias).
- Prisma: uso de `schema.prisma` con relaciones, índices y enums explícitos.
- Testing: Jest + ts-jest (configuración en `package.json`).
- Seguridad: Passport + JWT (guards y estrategias presentes).
- Reglas ESLint destacadas:
  - `@typescript-eslint/no-explicit-any`: OFF.
  - `@typescript-eslint/no-floating-promises`: WARN.
  - `@typescript-eslint/no-unsafe-argument`: WARN.

Observaciones rápidas:

- Hay pequeñas inconsistencias de naming en carpetas (`diagram_members` vs `diagram-socket`).
- TypeScript no está en modo completamente estricto (`noImplicitAny: false`).

Recomendación mínima (opcional): habilitar `noImplicitAny`, unificar naming de carpetas a `kebab-case`, y convertir warnings importantes de ESLint a `error` para mantener calidad.
