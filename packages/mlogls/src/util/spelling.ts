// This has been copied from typescript's spelling suggestion code
// if anything ever goes wrong, do a diff to see if they fixed it on upstream
// https://github.com/microsoft/TypeScript/blob/8da951cbb629b648753454872df4e1754982aef1/src/compiler/core.ts#L2167-L2242

// #region copied
export function getSpellingSuggestion<T>(
  name: string,
  candidates: Iterable<T>,
  getName: (candidate: T) => string | undefined
): T | undefined {
  const maximumLengthDifference = Math.max(2, Math.floor(name.length * 0.34));
  let bestDistance = Math.floor(name.length * 0.4) + 1; // If the best result is worse than this, don't bother.
  let bestCandidate: T | undefined;

  for (const candidate of candidates) {
    const candidateName = getName(candidate);
    if (
      candidateName !== undefined &&
      Math.abs(candidateName.length - name.length) <= maximumLengthDifference
    ) {
      if (candidateName === name) {
        continue;
      }
      // Only consider candidates less than 3 characters long when they differ by case.
      // Otherwise, don't bother, since a user would usually notice differences of a 2-character name.
      if (
        candidateName.length < 3 &&
        candidateName.toLowerCase() !== name.toLowerCase()
      ) {
        continue;
      }

      const distance = levenshteinWithMax(
        name,
        candidateName,
        bestDistance - 0.1
      );
      if (distance === undefined) {
        continue;
      }

      // Debug.assert(distance < bestDistance); // Else `levenshteinWithMax` should return undefined
      bestDistance = distance;
      bestCandidate = candidate;
    }
  }
  return bestCandidate;
}

function levenshteinWithMax(
  s1: string,
  s2: string,
  max: number
): number | undefined {
  let previous = new Array<number>(s2.length + 1);
  let current = new Array<number>(s2.length + 1);
  /** Represents any value > max. We don't care about the particular value. */
  const big = max + 0.01;

  for (let i = 0; i <= s2.length; i++) {
    previous[i] = i;
  }

  for (let i = 1; i <= s1.length; i++) {
    const c1 = s1.charCodeAt(i - 1);
    const minJ = Math.ceil(i > max ? i - max : 1);
    const maxJ = Math.floor(s2.length > max + i ? max + i : s2.length);
    current[0] = i;
    /** Smallest value of the matrix in the ith column. */
    let colMin = i;
    for (let j = 1; j < minJ; j++) {
      current[j] = big;
    }
    for (let j = minJ; j <= maxJ; j++) {
      // case difference should be significantly cheaper than other differences
      const substitutionDistance =
        s1[i - 1].toLowerCase() === s2[j - 1].toLowerCase()
          ? previous[j - 1] + 0.1
          : previous[j - 1] + 2;
      const dist =
        c1 === s2.charCodeAt(j - 1)
          ? previous[j - 1]
          : Math.min(
              /*delete*/ previous[j] + 1,
              /*insert*/ current[j - 1] + 1,
              /*substitute*/ substitutionDistance
            );
      current[j] = dist;
      colMin = Math.min(colMin, dist);
    }
    for (let j = maxJ + 1; j <= s2.length; j++) {
      current[j] = big;
    }
    if (colMin > max) {
      // Give up -- everything in this column is > max and it can't get better in future columns.
      return undefined;
    }

    const temp = previous;
    previous = current;
    current = temp;
  }

  const res = previous[s2.length];
  return res > max ? undefined : res;
}
// #endregion

// modified version of
// https://github.com/microsoft/TypeScript/blob/8da951cbb629b648753454872df4e1754982aef1/src/compiler/checker.ts#L34661-L34698
// TODO: update doc comments

/**
 * Given a name and a list of symbols whose names are _not_ equal to the name,
 * return a spelling suggestion if there is one that is close enough. Names less
 * than length 3 only check for case-insensitive equality, not levenshtein
 * distance.
 *
 * If there is a candidate that's the same except for case, return that. If
 * there is a candidate that's within one edit of the name, return that.
 * Otherwise, return the candidate with the smallest Levenshtein distance,
 * except for candidates: **With no name** Whose meaning doesn't match the
 * `meaning` parameter. * Whose length differs from the target name by more than
 * 0.34 of the length of the name. * whose levenshtein distance is more than 0.4
 * of the length of the name (0.4 allows 1 substitution/transposition for every
 * 5 characters, and 1 insertion/deletion at 3 characters)
 */
export function getSpellingSuggestionForName(
  name: string,
  symbols: Iterable<string>
): string | undefined {
  return getSpellingSuggestion(name, symbols, (name) => name);
}
