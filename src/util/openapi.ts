/* Copyright (c) Fortanix, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { type OpenAPIV3_1 as OpenApi } from 'openapi-types';


export type OpenApiRef = string;

export type OpenApiSchema = OpenApi.ReferenceObject | OpenApi.SchemaObject;
export type OpenApiSchemaId = string;


const unescapeJsonPointerSegment = (segment: string): string =>
  segment.replace(/~1/g, '/').replace(/~0/g, '~');
export const decodeJsonPointer = (jsonPointer: string): Array<string> => {
  const jsonPointerTrimmed = jsonPointer.trim();
  if (jsonPointerTrimmed === '') { return []; }
  if (jsonPointerTrimmed.charAt(0) !== '/') { throw new Error(`Invalid JSON Pointer: ${jsonPointer}`); }
  return jsonPointer.substring(1).split('/').map(segment => unescapeJsonPointerSegment(segment));
};

const escapeJsonPointerSegment = (segment: string): string =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1');
export const encodeJsonPointer = (segments: Array<string>): string => {
  return '/' + segments.map(segment => escapeJsonPointerSegment(segment)).join('/');
};
