import {
  Definition,
  DefinitionLink,
  Location,
  Position,
} from "vscode-languageserver";
import { MlogDocument } from "../document";
import { containsPosition, getSelectedSyntaxNode } from "./common";
import { isDocComment } from "../analysis/doc_comments";
import {
  labelDeclarationNameRange,
  findVariableWriteLocations,
  findLabelDefinition,
  findLabelReferences,
  findVariableUsageLocations,
} from "../analysis/symbol_resolution";
import { ParameterType } from "../parser/descriptors";
import { LabelDeclaration, InstructionNode } from "../parser/nodes";

export function getDefinitions(
  doc: MlogDocument,
  position: Position
): Definition | DefinitionLink[] | undefined {
  const node = getSelectedSyntaxNode(doc, position);
  if (!node) return;

  if (
    node instanceof LabelDeclaration &&
    containsPosition(node.nameToken, position)
  ) {
    return {
      uri: doc.uri,
      range: labelDeclarationNameRange(node.nameToken),
    };
  }

  if (isDocComment(node) && node.docAnnotation) {
    const { variableName, variableStart, annotationEnd } = node.docAnnotation;

    const offset = position.character - node.start.character;
    if (offset < variableStart || offset > annotationEnd) return;

    return findVariableWriteLocations(variableName, doc.nodes).map(
      (location) => ({
        uri: doc.uri,
        range: location,
      })
    );
  }

  if (!(node instanceof InstructionNode)) return;

  const selectedParameter = node.parameters.find((param) =>
    containsPosition(param.token, position)
  );

  if (!selectedParameter?.token.isIdentifier()) return;

  const name = selectedParameter.token.content;

  switch (selectedParameter.type) {
    case ParameterType.variable:
      return findVariableWriteLocations(name, doc.nodes).map((location) => ({
        uri: doc.uri,
        range: location,
      }));
    case ParameterType.label: {
      const location = findLabelDefinition(name, doc.nodes);
      if (!location) return;

      return {
        uri: doc.uri,
        range: location,
      };
    }
  }
}

export function getReferences(
  doc: MlogDocument,
  position: Position
): Location[] | undefined {
  const node = getSelectedSyntaxNode(doc, position);
  if (!node) return;

  if (
    node instanceof LabelDeclaration &&
    containsPosition(node.nameToken, position)
  ) {
    const locations = findLabelReferences(node.name, doc.nodes);

    return locations.map((location) => ({
      uri: doc.uri,
      range: location,
    }));
  }

  if (isDocComment(node) && node.docAnnotation) {
    const { variableName, variableStart, annotationEnd } = node.docAnnotation;

    const offset = position.character - node.start.character;
    if (offset < variableStart || offset > annotationEnd) return;

    return findVariableUsageLocations(variableName, doc.nodes).map(
      (location) => ({
        uri: doc.uri,
        range: location,
      })
    );
  }

  if (!(node instanceof InstructionNode)) return;

  const selectedParameter = node.parameters.find((param) =>
    containsPosition(param.token, position)
  );

  if (!selectedParameter?.token.isIdentifier()) return;

  const name = selectedParameter.token.content;

  switch (selectedParameter.type) {
    case ParameterType.variable:
      return findVariableUsageLocations(name, doc.nodes).map((location) => ({
        uri: doc.uri,
        range: location,
      }));
    case ParameterType.label:
      return findLabelReferences(name, doc.nodes).map((location) => ({
        uri: doc.uri,
        range: location,
      }));
  }
}
