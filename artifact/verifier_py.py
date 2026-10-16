#!/usr/bin/env python3
"""Rebuilt 2026-10-13: independent stdlib Fraction semantic verifier."""
import hashlib
import json
import re
import sys
from fractions import Fraction as F


def require(test, message):
    if not test:
        raise ValueError(message)


def shape(obj, fields, name):
    require(isinstance(obj, dict) and set(obj) == set(fields), name + ': schema fields differ')


def integer(value):
    require(isinstance(value, str) and re.fullmatch(r'-?\d+', value, flags=re.ASCII), 'decimal integer string required')
    return int(value)


def rational(value):
    shape(value, ['n', 'd'], 'rational')
    n, d = integer(value['n']), integer(value['d'])
    require(d > 0, 'nonpositive denominator')
    result = F(n, d)
    require(str(result.numerator) == value['n'] and str(result.denominator) == value['d'], 'non-reduced rational')
    return result


def canonical(value):
    # Explicit type walk prevents bool/int confusion and all numeric wire values.
    if isinstance(value, list):
        return '[' + ','.join(canonical(v) for v in value) + ']'
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canonical(value[k]) for k in sorted(value)) + '}'
    require(value is None or isinstance(value, (str, bool)), 'non-schema numeric or unsupported value')
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def check_digest(doc):
    digest = doc['digest']
    require(isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest), 'invalid digest encoding')
    semantic = {k: v for k, v in doc.items() if k != 'digest'}
    require(hashlib.sha256(canonical(semantic).encode('utf-8')).hexdigest() == digest, 'digest mismatch')


def elapsed_bounds(x, epsilon, eta):
    low, high = x - 2 * eta, x + 2 * eta
    rates = (F(1000000 - epsilon, 1000000), F(1000000 + epsilon, 1000000))
    extremes = [F(v) / r for v in (low, high) for r in rates]
    return min(extremes), max(extremes)


def verify_assignment(w, observations, budgets, limits, margin, kind):
    shape(w, ['outcome', 'assignment'], 'witness')
    shape(w['assignment'], ['sender', 'receiver', 'real'], 'assignment')
    endpoints = {}
    for name, rate_budget, error_budget in [('sender', 'epsilonSenderPpm', 'etaSenderUs'), ('receiver', 'epsilonReceiverPpm', 'etaReceiverUs')]:
        raw = w['assignment'][name]
        shape(raw, ['rate', 'offsetUs', 'readErrorAUs', 'readErrorBUs', 'readErrorCloseUs'], name)
        ep = {k: None if v is None else rational(v) for k, v in raw.items()}
        eps, eta = budgets[rate_budget], budgets[error_budget]
        require(ep['rate'] is not None and ep['offsetUs'] is not None, 'missing clock rate/offset')
        require(F(1000000-eps,1000000) <= ep['rate'] <= F(1000000+eps,1000000), name + ' rate outside budget')
        for k in ['readErrorAUs', 'readErrorBUs', 'readErrorCloseUs']:
            require(ep[k] is None or abs(ep[k]) <= eta, name + ' read error outside budget')
        endpoints[name] = ep
    real_names = ['sendAUs', 'sendBUs', 'receiveAUs', 'receiveBUs', 'closeUs', 'delayAUs', 'delayBUs', 'delayDifferenceUs', 'completionWaitAUs', 'completionWaitBUs']
    shape(w['assignment']['real'], real_names, 'real')
    t = {k: None if v is None else rational(v) for k, v in w['assignment']['real'].items()}
    require(all(t[k] is not None for k in real_names if k != 'closeUs'), 'missing real assignment')
    require(all(t[k] >= 0 for k in real_names if k not in ['closeUs', 'delayDifferenceUs']), 'negative real time/delay/wait')
    require(t['receiveAUs'] - t['sendAUs'] == t['delayAUs'] and t['receiveBUs'] - t['sendBUs'] == t['delayBUs'], 'delay equations fail')
    z = t['delayDifferenceUs']
    require(t['delayAUs'] - t['delayBUs'] == z, 'delay difference equation fails')
    policy = 'force-a' if z < -margin else 'force-b' if z > margin else 'neutral'
    require(w['outcome'] == policy, 'witness policy region fails')
    lo, hi = limits
    require((lo is None or lo <= z) and (hi is None or z <= hi), 'witness outside interval')

    def clock(ep, error, time, reading):
        require(error is not None and ep['rate'] * time + ep['offsetUs'] + error == reading, 'affine clock equation fails')

    s, r = endpoints['sender'], endpoints['receiver']
    require(s['readErrorCloseUs'] is None, 'sender has no close observation')
    clock(s, s['readErrorAUs'], t['sendAUs'], observations['sendAUs'])
    clock(s, s['readErrorBUs'], t['sendBUs'], observations['sendBUs'])
    for path in 'AB':
        reading, error = observations['recv' + path + 'Us'], r['readError' + path + 'Us']
        if reading is None:
            require(error is None, 'censored arrival has a read error')
        else:
            clock(r, error, t['receive' + path + 'Us'], reading)
    if kind == 'paired-arrivals':
        require(t['closeUs'] is None and r['readErrorCloseUs'] is None, 'paired witness must not invent close reading')
        require(t['completionWaitAUs'] == 0 and t['completionWaitBUs'] == 0, 'paired waits must be zero')
    else:
        require(t['closeUs'] is not None and t['closeUs'] >= 0, 'censored close missing or negative')
        clock(r, r['readErrorCloseUs'], t['closeUs'], observations['closeUs'])
        for path in 'AB':
            received, wait = t['receive' + path + 'Us'], t['completionWait' + path + 'Us']
            if observations['recv' + path + 'Us'] is None:
                require(received >= t['closeUs'] and wait == received - t['closeUs'], 'censored event order/wait fails')
            else:
                require(received <= t['closeUs'] and wait == 0, 'observed arrival order/wait fails')


def verify_race(c):
    shape(c, ['schema', 'scenarioId', 'source', 'capture', 'evidenceKind', 'assumptions', 'observations', 'interval', 'outcome', 'feasible', 'witnesses', 'digest'], 'race')
    check_digest(c)
    require(c['schema'] == 'racecert-v2' and isinstance(c['scenarioId'], str) and c['scenarioId'], 'invalid race identity')
    require(c['source'] in ['live-udp', 'frozen-deterministic'] and isinstance(c['capture'], dict), 'invalid source/capture')
    fields = ['epsilonSenderPpm', 'epsilonReceiverPpm', 'etaSenderUs', 'etaReceiverUs', 'marginUs']
    shape(c['assumptions'], fields, 'assumptions')
    a = {k: integer(v) for k, v in c['assumptions'].items()}
    require(all(v >= 0 for v in a.values()) and a['epsilonSenderPpm'] < 1000000 and a['epsilonReceiverPpm'] < 1000000, 'invalid uncertainty budget')
    shape(c['observations'], ['sendAUs', 'sendBUs', 'recvAUs', 'recvBUs', 'closeUs'], 'observations')
    o = {k: None if v is None else integer(v) for k, v in c['observations'].items()}
    require(all(o[k] is not None for k in ['sendAUs', 'sendBUs', 'closeUs']), 'missing send/close observation')
    if 'observations' in c['capture']:
        require(canonical(c['capture']['observations']) == canonical(c['observations']), 'capture observation binding fails')
    sl, sh = elapsed_bounds(o['sendAUs'] - o['sendBUs'], a['epsilonSenderPpm'], a['etaSenderUs'])
    if o['recvAUs'] is not None and o['recvBUs'] is not None:
        rl, rh = elapsed_bounds(o['recvAUs'] - o['recvBUs'], a['epsilonReceiverPpm'], a['etaReceiverUs'])
        lo, hi, kind = rl - sh, rh - sl, 'paired-arrivals'
    elif o['recvAUs'] is not None:
        gl, gh = elapsed_bounds(o['recvAUs'] - o['closeUs'], a['epsilonReceiverPpm'], a['etaReceiverUs'])
        require(gl <= 0, 'A cannot precede close')
        lo, hi, kind = None, min(gh, F(0)) - sl, 'a-only-censored'
    elif o['recvBUs'] is not None:
        gl, gh = elapsed_bounds(o['closeUs'] - o['recvBUs'], a['epsilonReceiverPpm'], a['etaReceiverUs'])
        require(gh >= 0, 'B cannot precede close')
        lo, hi, kind = max(gl, F(0)) - sh, None, 'b-only-censored'
    else:
        lo, hi, kind = None, None, 'no-arrival'
    require(c['evidenceKind'] == kind, 'evidence kind mismatch')
    shape(c['interval'], ['lo', 'hi', 'loClosed', 'hiClosed'], 'interval')
    require(c['interval']['loClosed'] == 'true' and c['interval']['hiClosed'] == 'true', 'interval closure mismatch')
    for name, expected in [('lo', lo), ('hi', hi)]:
        actual = c['interval'][name]
        require(actual is None if expected is None else actual is not None and rational(actual) == expected, 'interval mismatch')
    m, feasible = a['marginUs'], []
    if lo is None or lo < -m:
        feasible.append('force-a')
    if (lo is None or lo <= m) and (hi is None or hi >= -m):
        feasible.append('neutral')
    if hi is None or hi > m:
        feasible.append('force-b')
    outcome = feasible[0] if len(feasible) == 1 else 'ambiguous'
    require(c['outcome'] == outcome and c['feasible'] == feasible, 'outcome/feasible mismatch')
    require(isinstance(c['witnesses'], list), 'witness array required')
    expected = feasible if outcome == 'ambiguous' else []
    require([w['outcome'] for w in c['witnesses']] == expected, 'complete witness set mismatch')
    for w in c['witnesses']:
        verify_assignment(w, o, a, (lo, hi), m, kind)
    return {'ok': True, 'kind': 'race', 'digest': c['digest'], 'outcome': outcome, 'witnessesVerified': len(c['witnesses'])}


def verify_batch(c):
    shape(c, ['schema', 'batchId', 'denominator', 'certificateDigests', 'counts', 'decision', 'certificates', 'digest'], 'batch')
    check_digest(c)
    require(isinstance(c['batchId'], str) and isinstance(c['certificates'], list) and c['certificates'], 'invalid batch')
    n = len(c['certificates'])
    require(integer(c['denominator']) == n, 'fixed denominator mismatch')
    counts = dict.fromkeys(['force-a', 'neutral', 'force-b', 'ambiguous'], 0)
    for r in c['certificates']:
        verify_race(r)
        counts[r['outcome']] += 1
    require(c['certificateDigests'] == [r['digest'] for r in c['certificates']], 'constituent digest binding mismatch')
    shape(c['counts'], counts, 'counts')
    require(all(integer(c['counts'][k]) == v for k, v in counts.items()), 'batch count mismatch')
    decision = 'force-a-majority' if 2 * counts['force-a'] > n else 'force-b-majority' if 2 * counts['force-b'] > n else 'no-forced-path-majority'
    require(c['decision'] == decision, 'batch majority mismatch')
    return {'ok': True, 'kind': 'batch', 'digest': c['digest'], 'denominator': c['denominator'], 'decision': decision, 'racesVerified': n}


def verify_document(c):
    try:
        return verify_batch(c) if isinstance(c, dict) and c.get('schema') == 'racecert-batch-v1' else verify_race(c)
    except Exception as e:
        return {'ok': False, 'reason': str(e)}


if __name__ == '__main__':
    try:
        if len(sys.argv) > 1:
            with open(sys.argv[1], encoding='utf-8') as stream:
                doc = json.load(stream)
        else:
            doc = json.load(sys.stdin)
        result = verify_document(doc)
    except Exception as exc:
        result = {'ok': False, 'reason': str(exc)}
    print(json.dumps(result, separators=(',', ':')))
    sys.exit(0 if result['ok'] else 1)
