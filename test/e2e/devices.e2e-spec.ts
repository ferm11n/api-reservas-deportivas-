// Comprueba que la persistencia real de dispositivos también está conectada al módulo API.
import { type AppDePrueba, crearApp } from '../utilities/create-app.js';
import { registrarJugador } from '../utilities/users.js';

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

describe('/dispositivos con el almacén persistente', () => {
  let a: AppDePrueba;
  beforeAll(async () => {
    a = await crearApp({
      notificacionesReales: true,
      entorno: { NOTIFICACIONES: 'registro' },
    });
  });
  afterAll(() => a.cerrar());

  it('registra, cuenta en la prueba y da de baja un dispositivo', async () => {
    const j = await registrarJugador(a);
    const con = { Authorization: `Bearer ${j.token}` };
    await a
      .http()
      .post('/dispositivos')
      .set(con)
      .send({ tokenExpo: TOKEN, plataforma: 'ios' })
      .expect(201);

    const prueba = await a
      .http()
      .post('/dispositivos/prueba')
      .set(con)
      .expect(200);
    expect(prueba.body.datos.dispositivos).toBe(1);
    await a
      .http()
      .delete(`/dispositivos/${encodeURIComponent(TOKEN)}`)
      .set(con)
      .expect(204);

    const luegoDeBaja = await a
      .http()
      .post('/dispositivos/prueba')
      .set(con)
      .expect(200);
    expect(luegoDeBaja.body.datos.dispositivos).toBe(0);
  });
});
