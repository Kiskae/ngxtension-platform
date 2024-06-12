import {
	formatFiles,
	getProjects,
	joinPathFragments,
	logger,
	readJson,
	readProjectConfiguration,
	Tree,
	visitNotIgnoredFiles,
} from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { exit } from 'node:process';
import { Node, SyntaxKind } from 'ts-morph';
import { ContentsStore } from '../shared-utils/contents-store';
import { ConvertToSFCGeneratorSchema } from './schema';

function trackContents(
	tree: Tree,
	contentsStore: ContentsStore,
	fullPath: string,
) {
	if (fullPath.endsWith('.ts')) {
		const fileContent =
			tree.read(fullPath, 'utf8') || readFileSync(fullPath, 'utf8');
		if (!fileContent.includes('@Component')) return;
		if (fileContent.includes('templateUrl')) {
			contentsStore.track(fullPath, fileContent);
		}
	}
}

export async function convertToSFCGenerator(
	tree: Tree,
	options: ConvertToSFCGeneratorSchema,
) {
	const contentsStore = new ContentsStore();
	const packageJson = readJson(tree, 'package.json');
	const angularCorePackage =
		packageJson['dependencies']['@angular/core'] ||
		packageJson['devDependencies']['@angular/core'];

	if (!angularCorePackage) {
		logger.error(`[ngxtension] No @angular/core detected`);
		return exit(1);
	}

	const { path, project, moveStyles, maxInlineTemplateLines } = options;

	if (path && project) {
		logger.error(
			`[ngxtension] Cannot pass both "path" and "project" to convertToSFCGenerator`,
		);
		return exit(1);
	}

	if (path) {
		if (!tree.exists(path)) {
			logger.error(`[ngxtension] "${path}" does not exist`);
			return exit(1);
		}

		trackContents(tree, contentsStore, path);
	} else if (project) {
		try {
			const projectConfiguration = readProjectConfiguration(tree, project);

			if (!projectConfiguration) {
				throw `"${project}" project not found`;
			}

			visitNotIgnoredFiles(tree, projectConfiguration.root, (path) => {
				trackContents(tree, contentsStore, path);
			});
		} catch (err) {
			logger.error(`[ngxtension] ${err}`);
			return;
		}
	} else {
		const projects = getProjects(tree);
		for (const project of projects.values()) {
			visitNotIgnoredFiles(tree, project.root, (path) => {
				trackContents(tree, contentsStore, path);
			});
		}
	}

	for (const { path: sourcePath } of contentsStore.collection) {
		if (!sourcePath.endsWith('.ts')) continue;

		const sourceFile = contentsStore.project.getSourceFile(sourcePath)!;

		const classes = sourceFile.getClasses();

		for (const targetClass of classes) {
			const applicableDecorator = targetClass.getDecorator((decoratorDecl) => {
				return ['Component'].includes(decoratorDecl.getName());
			});
			if (!applicableDecorator) continue;

			const decoratorArg = applicableDecorator.getArguments()[0];
			if (Node.isObjectLiteralExpression(decoratorArg)) {
				decoratorArg
					.getChildrenOfKind(SyntaxKind.PropertyAssignment)
					.forEach((property) => {
						const decoratorPropertyName = property.getName();
						if (decoratorPropertyName === 'templateUrl') {
							const dir = dirname(sourcePath);
							const templatePath = joinPathFragments(
								dir,
								property
									.getInitializer()
									.getText()
									.slice(1, property.getInitializer().getText().length - 1),
							);
							let templateText = tree.exists(templatePath)
								? tree.read(templatePath, 'utf8')
								: '';

							let templateTextLines = templateText.split('\n').length;

							// if the template is not too long and does not contain any js interpolation
							if (
								!templateText.includes('${') &&
								templateTextLines <= maxInlineTemplateLines
							) {
								try {
									// replace the templateUrl with the template
									property.replaceWithText(`template: \`\n${templateText}\n\``);

									contentsStore.track(templatePath, templateText);

									// remove the templateUrl file
									tree.delete(templatePath);

									if (moveStyles) {
										console.log('TODO: move styles');
									}
								} catch (err) {
									logger.error(
										`[ngxtension] Skipping ${sourcePath} due to error: ${err}`,
									);
								}
							}
						}

						if (moveStyles) {
							if (
								decoratorPropertyName === 'styleUrls' ||
								decoratorPropertyName === 'styleUrl'
							) {
								// TODO: move styles
							}
						}
					});
			}
		}

		tree.write(sourcePath, sourceFile.getFullText());
	}

	await formatFiles(tree);

	logger.info(
		`
[ngxtension] Conversion completed. Please check the content and run your formatter as needed.
`,
	);
}

export default convertToSFCGenerator;
