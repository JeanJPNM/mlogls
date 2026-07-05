import { Position, Range, TextEdit } from "vscode-languageserver";
import { MlogDocument } from "../document";
import { isDocComment } from "../analysis/doc_comments";
import {
  findLabelReferences,
  findVariableUsageLocations,
  labelDeclarationNameRange,
} from "../analysis/symbol_resolution";
import { ParameterType } from "../parser/descriptors";
import { LabelDeclaration, InstructionNode } from "../parser/nodes";
import { getSelectedSyntaxNode, containsPosition } from "./common";

export function getRenamePreparation(
  doc: MlogDocument,
  position: Position
): { range: Range; placeholder: string } | undefined {
  const node = getSelectedSyntaxNode(doc, position);
  if (!node) return;

  if (
    node instanceof LabelDeclaration &&
    containsPosition(node.nameToken, position)
  ) {
    return {
      range: labelDeclarationNameRange(node.nameToken),
      placeholder: node.name,
    };
  }

  if (isDocComment(node) && node.docAnnotation) {
    const { variableName, variableStart, annotationEnd } = node.docAnnotation;

    const offset = position.character - node.start.character;
    if (offset < variableStart || offset > annotationEnd) return;

    return {
      range: Range.create(
        node.start.line,
        node.start.character + variableStart,
        node.start.line,
        node.start.character + annotationEnd
      ),
      placeholder: variableName,
    };
  }

  if (!(node instanceof InstructionNode)) return;

  const selectedParameter = node.parameters.find((param) =>
    containsPosition(param.token, position)
  );

  if (!selectedParameter?.token.isIdentifier()) return;

  const name = selectedParameter.token.content;

  switch (selectedParameter.type) {
    case ParameterType.variable:
    case ParameterType.label:
      return {
        range: selectedParameter.token,
        placeholder: name,
      };
  }
}

export function getRenameEdits(
  doc: MlogDocument,
  position: Position,
  newName: string
): TextEdit[] | undefined {
  const node = getSelectedSyntaxNode(doc, position);
  if (!node) return;

  if (
    node instanceof LabelDeclaration &&
    containsPosition(node.nameToken, position)
  ) {
    const locations = findLabelReferences(node.name, doc.nodes);

    return locations.map((location) => ({
      range: location,
      newText: newName,
    }));
  }

  if (isDocComment(node) && node.docAnnotation) {
    const { variableName, variableStart, annotationEnd } = node.docAnnotation;

    const offset = position.character - node.start.character;
    if (offset < variableStart || offset > annotationEnd) return;

    const locations = findVariableUsageLocations(variableName, doc.nodes);

    return locations.map((location) => ({
      range: location,
      newText: newName,
    }));
  }

  if (!(node instanceof InstructionNode)) return;

  const selectedParameter = node.parameters.find((param) =>
    containsPosition(param.token, position)
  );

  if (!selectedParameter?.token.isIdentifier()) return;

  const name = selectedParameter.token.content;

  switch (selectedParameter.type) {
    case ParameterType.variable: {
      const locations = findVariableUsageLocations(name, doc.nodes);

      return locations.map((location) => ({
        range: location,
        newText: newName,
      }));
    }
    case ParameterType.label: {
      const labelReferences = findLabelReferences(name, doc.nodes);

      return labelReferences.map((location) => ({
        range: location,
        newText: newName,
      }));
    }
  }
}
