import { z } from "zod";

/** The :id of a ticket or a request. Anything else is a 400. */
export const idParams = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

export const idOf = (params: unknown): number => idParams.parse(params).id;
