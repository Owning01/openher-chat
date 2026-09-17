import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import { DB_NAME, closeOwnerDb } from './idb';
import { IndexedDbSkills } from './IndexedDbSkills';

let counter = 0;

function repo(now = 1): IndexedDbSkills {
  return new IndexedDbSkills({ now: () => now, newId: () => `skill_${(counter += 1)}` });
}

afterEach(async () => {
  closeOwnerDb();
  await deleteDB(DB_NAME);
});

describe('IndexedDbSkills', () => {
  it('guarda, lista por nombre y elimina', async () => {
    const skills = repo();
    await skills.save({ name: 'zeta', description: 'Z', body: 'z' });
    await skills.save({ name: 'Alfa', description: 'A', body: 'a' });

    const list = await skills.list();
    expect(list.map((skill) => skill.name)).toEqual(['Alfa', 'zeta']);
    expect(list[0]?.createdAt).toBe(1);

    await skills.remove(list[0]!.id);
    expect((await skills.list()).map((skill) => skill.name)).toEqual(['zeta']);
  });

  it('editar conserva createdAt y actualiza updatedAt y campos', async () => {
    let now = 10;
    const skills = new IndexedDbSkills({ now: () => now, newId: () => 'skill_fixed' });
    const created = await skills.save({ name: 'x', description: 'd', body: 'b' });

    now = 20;
    const updated = await skills.save({ id: created.id, name: '  x2  ', description: ' d2 ', body: 'b2' });

    expect(updated).toMatchObject({ id: 'skill_fixed', name: 'x2', description: 'd2', body: 'b2', createdAt: 10, updatedAt: 20 });
    expect(await skills.list()).toHaveLength(1);
  });

  it('list devuelve copias: mutar el resultado no toca lo persistido', async () => {
    const skills = repo();
    await skills.save({ name: 'a', description: '', body: 'b' });

    const [first] = await skills.list();
    first!.name = 'cambiado';

    expect((await skills.list())[0]?.name).toBe('a');
  });
});
