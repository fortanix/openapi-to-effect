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
