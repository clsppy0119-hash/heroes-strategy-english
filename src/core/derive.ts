import {
  BASE_DAMAGE_RATE,
  COUNTER_BY_LEVEL,
  CRIT_BASE,
  CRIT_MAX,
  CRIT_STEP,
  START_TROOPS,
  requiredCorrect,
  roundsFor,
} from './config';

/**
 * 從通關規則推導守軍血量。
 *
 * 規則是「LV.N 出 N 題，答對 requiredCorrect(N) 題才拿得下」。血量必須剛好落在
 * 「差一題的最好情況」與「剛好達標的最壞情況」之間，否則規則就不成立。
 *
 * 做法是把該等級的所有作答序列枚舉一遍（3^N 種，N≤3 時最多 27 種），
 * 算出每一種的總傷害，然後取「達標序列裡最低的傷害」當血量。
 * 再驗證它嚴格大於「未達標序列裡最高的傷害」——不成立就在載入時丟錯。
 *
 * 為什麼不手調：第一版是我手算血量去湊門檻，每改一次傷害公式就要重算，
 * 而且沒有任何東西保證我算對。現在規則是唯一真實來源，數值是它的結果。
 */

export function multiplierFor(streak: number): number {
  if (streak <= 0) {
    return 1;
  }
  return Math.min(CRIT_BASE + (streak - 1) * CRIT_STEP, CRIT_MAX);
}

/** 一整條作答序列打出的總傷害。true＝答對，false＝答錯或跳過。 */
function totalDamage(level: number, answers: readonly boolean[]): number {
  const counter = counterFor(level);
  let troops = START_TROOPS;
  let streak = 0;
  let total = 0;
  for (const correct of answers) {
    streak = correct ? streak + 1 : Math.max(0, streak - 1);
    total += Math.floor(troops * BASE_DAMAGE_RATE * multiplierFor(streak));
    troops -= counter;
    if (troops <= 0) {
      break;
    }
  }
  return total;
}

/** 該等級的所有作答序列。答錯與跳過在傷害上等價，所以只需要二元枚舉。 */
function allSequences(rounds: number): boolean[][] {
  const out: boolean[][] = [];
  for (let mask = 0; mask < 2 ** rounds; mask += 1) {
    out.push(Array.from({ length: rounds }, (_, i) => ((mask >> i) & 1) === 1));
  }
  return out;
}

export function counterFor(level: number): number {
  const counter = COUNTER_BY_LEVEL[level];
  if (counter === undefined) {
    throw new RangeError(`no counter configured for tile level ${level}`);
  }
  return counter;
}

function derive(level: number): number {
  const rounds = roundsFor(level);
  const need = requiredCorrect(level);

  let minPass = Number.POSITIVE_INFINITY;
  let maxFail = Number.NEGATIVE_INFINITY;

  for (const answers of allSequences(rounds)) {
    const correct = answers.filter(Boolean).length;
    const damage = totalDamage(level, answers);
    if (correct >= need) {
      minPass = Math.min(minPass, damage);
    } else {
      maxFail = Math.max(maxFail, damage);
    }
  }

  if (!Number.isFinite(minPass)) {
    throw new Error(`LV.${level}: no answer sequence reaches ${need} correct`);
  }
  // 沒有未達標序列（LV.1 的 need=0）時，任何序列都該贏，取最低的傷害當血量。
  // 開發者看的錯誤，跟 core 其他訊息一樣用英文——它不會出現在玩家眼前。
  if (Number.isFinite(maxFail) && minPass <= maxFail) {
    throw new Error(
      `LV.${level}: cannot derive defender hp. Worst case with ${need} correct deals ${minPass}, ` +
        `but best case one short already deals ${maxFail}. Adjust the damage formula or the threshold.`,
    );
  }

  return minPass;
}

const CACHE = new Map<number, number>();

/** 守軍血量。第一次呼叫時推導並快取；推導不出來就丟錯。 */
export function defenderHpFor(level: number): number {
  const cached = CACHE.get(level);
  if (cached !== undefined) {
    return cached;
  }
  const hp = derive(level);
  CACHE.set(level, hp);
  return hp;
}
