import {
  BASE_DAMAGE_RATE,
  COUNTER_BY_LEVEL,
  CRIT_BASE,
  CRIT_MAX,
  CRIT_STEP,
  MORALE_FLOOR,
  MORALE_FULL,
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

/**
 * 一擊打多少。
 *
 * **傷害只有這一個公式。** 之前它被抄在五個地方（結算、預覽、兩個上下界、
 * 推導），加士氣的時候只要漏掉其中一個，畫面上的預覽就會跟實際結算對不起來
 * ——而那種錯不會報錯，只會讓玩家覺得數字在騙人。
 */
export function strikeDamage(troops: number, streak: number, morale: number): number {
  return Math.floor(troops * BASE_DAMAGE_RATE * multiplierFor(streak) * morale);
}

export function multiplierFor(streak: number): number {
  if (streak <= 0) {
    return 1;
  }
  return Math.min(CRIT_BASE + (streak - 1) * CRIT_STEP, CRIT_MAX);
}

/** 一整條作答序列打出的總傷害。true＝答對，false＝答錯或跳過。 */
function totalDamage(level: number, answers: readonly boolean[], morale: number): number {
  const counter = counterFor(level);
  let troops = START_TROOPS;
  let streak = 0;
  let total = 0;
  for (const correct of answers) {
    streak = correct ? streak + 1 : Math.max(0, streak - 1);
    total += strikeDamage(troops, streak, morale);
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

/**
 * 推導守軍血量。
 *
 * ## 士氣讓「在什麼條件下推導」變成一個選擇
 *
 * 士氣會等比降低傷害，所以通關規則不可能在所有士氣下都剛好成立。兩種等級
 * 分開處理：
 *
 * - **requiredCorrect 為 0 的等級（LV.1）按最低士氣推導。** 那是入門坡，
 *   「跳過也拿得下」必須永遠成立，不能因為玩家遠征太久就消失。
 * - **其餘等級按滿士氣推導。** 通關規則在滿士氣時剛好成立；士氣低就要多
 *   答對幾題。那正是士氣要做到的事——遠征需要更好的表現。
 *
 * 兩種情況都受同一條保證：最低士氣下全部答對仍然打得贏（見 assertWinnable）。
 * 沒有那條保證，遠征夠久就會出現數學上贏不了的仗——v0.1 實測的根因（#14）。
 */
function derive(level: number): number {
  const rounds = roundsFor(level);
  const need = requiredCorrect(level);
  const morale = need === 0 ? MORALE_FLOOR : MORALE_FULL;

  let minPass = Number.POSITIVE_INFINITY;
  let maxFail = Number.NEGATIVE_INFINITY;

  for (const answers of allSequences(rounds)) {
    const correct = answers.filter(Boolean).length;
    const damage = totalDamage(level, answers, morale);
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

/**
 * 最低士氣下全部答對還打不打得贏。
 *
 * 打不贏的話玩家會卡在一場數學上贏不了的仗裡，而那不會有任何錯誤訊息——
 * 所以在載入時就驗，並且指名該調哪個常數。
 */
function assertWinnable(level: number, hp: number): void {
  const allCorrect = Array.from({ length: roundsFor(level) }, () => true);
  const best = totalDamage(level, allCorrect, MORALE_FLOOR);
  if (best < hp) {
    throw new Error(
      `LV.${level}: at the morale floor (${MORALE_FLOOR}) even a perfect run deals ${best}, ` +
        `short of ${hp}. Raise MORALE_FLOOR or lower the defender.`,
    );
  }
}

const CACHE = new Map<number, number>();

/** 守軍血量。第一次呼叫時推導並快取；推導不出來就丟錯。 */
export function defenderHpFor(level: number): number {
  const cached = CACHE.get(level);
  if (cached !== undefined) {
    return cached;
  }
  const hp = derive(level);
  assertWinnable(level, hp);
  CACHE.set(level, hp);
  return hp;
}
