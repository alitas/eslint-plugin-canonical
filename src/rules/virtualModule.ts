import { existsSync } from 'node:fs';
import path from 'node:path';
import { type TSESTree } from '@typescript-eslint/utils';
import resolve from 'eslint-module-utils/resolve';
import { Logger } from '../Logger';
import { createRule } from '../utilities';

const log = Logger.child({
  rule: 'virtual-module',
});

type Options =
  | [
      {
        includeModules?: string[];
      },
    ]
  | [];

type MessageIds = 'indexImport' | 'parentModuleImport' | 'privateModuleImport';

const findClosestDirectoryWithNeedle = (
  startPath: string,
  needleFileName: string,
  rootPath: string,
  allowList: string[] | null = null,
): string | null => {
  let currentDirectory = path.resolve(startPath, './');

  while (currentDirectory.startsWith(rootPath)) {
    if (
      existsSync(path.resolve(currentDirectory, needleFileName)) &&
      (allowList === null || allowList.includes(currentDirectory))
    ) {
      return currentDirectory;
    }

    currentDirectory = path.resolve(currentDirectory, '..');
  }

  return null;
};

const findProjectRoot = (startPath: string): string => {
  const projectRoot = findClosestDirectoryWithNeedle(
    startPath,
    'package.json',
    '/',
  );

  if (!projectRoot) {
    throw new Error('Project root could not be found.');
  }

  return projectRoot;
};

const findModuleRoot = (
  startPath: string,
  rootPath: string,
  allowList: string[] | null = null,
): string | null => {
  const moduleRoot = findClosestDirectoryWithNeedle(
    startPath,
    'index.ts',
    rootPath,
    allowList,
  );

  return moduleRoot;
};

export default createRule<Options, MessageIds>({
  create: (context, [options]) => {
    const visitDeclaration = (
      node:
        | TSESTree.ExportAllDeclaration
        | TSESTree.ExportNamedDeclaration
        | TSESTree.ImportDeclaration,
    ) => {
      let includeModules = options?.includeModules ?? null;

      if (includeModules) {
        includeModules = includeModules.map((modulePath) => {
          return path.dirname(modulePath);
        });
      }

      const currentDirectory = path.dirname(context.getFilename());
      const projectRootDirectory = findProjectRoot(currentDirectory);

      const importPath = node.source?.value;

      if (!importPath) {
        return;
      }

      const resolvedImportPath = resolve(importPath, context);

      if (!resolvedImportPath) {
        log.error({ importPath }, 'cannot resolve import');

        throw new Error('Cannot resolve import.');

        return;
      }

      const targetModuleRoot = findModuleRoot(
        resolvedImportPath,
        projectRootDirectory,
        includeModules,
      );

      if (!targetModuleRoot) {
        return;
      }

      const currentModuleRoot = findModuleRoot(
        currentDirectory,
        projectRootDirectory,
        includeModules,
      );

      if (currentModuleRoot === targetModuleRoot) {
        const importPathIsModuleIndex =
          path.basename(resolvedImportPath) === 'index.ts';

        if (importPathIsModuleIndex) {
          context.report({
            messageId: 'indexImport',
            node,
          });

          return;
        }

        return;
      }

      if (currentDirectory.startsWith(targetModuleRoot + path.sep)) {
        context.report({
          data: {
            currentModule:
              path.sep + path.relative(projectRootDirectory, currentDirectory),
            parentModule:
              path.sep + path.relative(projectRootDirectory, targetModuleRoot),
          },
          messageId: 'parentModuleImport',
          node,
        });

        return;
      }

      const targetParentModuleRoot = findModuleRoot(
        path.resolve(targetModuleRoot + path.sep + '..'),
        projectRootDirectory,
        includeModules,
      );

      if (targetParentModuleRoot) {
        context.report({
          data: {
            privatePath:
              path.sep + path.relative(targetModuleRoot, resolvedImportPath),
            targetModule:
              path.sep +
              path.relative(projectRootDirectory, targetParentModuleRoot),
          },
          messageId: 'privateModuleImport',
          node,
        });

        return;
      }

      log.info(
        {
          currentDirectory,
          targetModuleRoot,
          targetParentModuleRoot,
        },
        'valid import',
      );
    };

    return {
      ExportAllDeclaration: visitDeclaration,
      ExportNamedDeclaration: visitDeclaration,
      ImportDeclaration: visitDeclaration,
    };
  },
  defaultOptions: [{ includeModules: undefined }],
  meta: {
    docs: {
      description: '',
      recommended: 'error',
    },
    fixable: 'whitespace',
    messages: {
      indexImport:
        'Cannot import virtual module index from within the virtual module itself.',
      parentModuleImport:
        'Cannot import a parent virtual module. {{parentModule}} is a parent of {{currentModule}}.',
      privateModuleImport:
        'Cannot import a private path. {{privatePath}} belongs to {{targetModule}} virtual module.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          includeModules: {
            description:
              'A list of barrel files that identify virtual modules. Provide absolute paths to the index.ts files. If this value is not provided, then all barrel files in the project are assumed to be virtual module boundaries.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
        },
        type: 'object',
      },
    ],
    type: 'layout',
  },
  name: 'import-specifiers-newline',
});
