import { CircleDto } from '@circles/contracts';

/**
 * A circle row becomes the circle a client is given (§7.4: "Return a DTO; never
 * the raw row").
 *
 * Parsed on the way out, not cast. `CircleDto.parse` is what stops a column
 * added to `circles` next month from arriving at a client nobody told — and it
 * is the same schema the client validates against, so the two cannot disagree
 * about what a circle is.
 */
export function circleDto(row: unknown): CircleDto {
  const one = Array.isArray(row) ? row[0] : row;
  return CircleDto.parse(one);
}
