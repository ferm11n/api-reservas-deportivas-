// Verificación de las rutas de dispositivos y de los flujos que generan push.
import type { Dispositivo, PruebaDePush } from '../../contract/api.js';
import { type AppDePrueba, crearApp } from '../utilities/create-app.js';
import { esperarContrato, esperarError } from '../utilities/contract.js';
import { crearDeporte, crearEspacio } from '../utilities/venues.js';
import { crearReserva } from '../utilities/slots.js';
import {
  crearUsuario,
  registrarJugador,
  type UsuarioDePrueba,
} from '../utilities/users.js';
import { ServidorExpoFalso } from '../notifications/fake-expo-server.js';

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const con = (u: UsuarioDePrueba) => ({ Authorization: `Bearer ${u.token}` });

describe('Verificación de notificaciones push', () => {
  const expo = new ServidorExpoFalso();
  let a: AppDePrueba;
  beforeAll(async () => {
    await expo.iniciar();
    a = await crearApp({
      notificacionesReales: true,
      entorno: { NOTIFICACIONES: 'expo', EXPO_PUSH_URL: expo.url },
    });
  });
  afterAll(async () => {
    await a.cerrar();
    await expo.detener();
  });
  beforeEach(() => expo.vaciar());

  const alta = (u: UsuarioDePrueba, tokenExpo: string) =>
    a
      .http()
      .post('/dispositivos')
      .set(con(u))
      .send({ tokenExpo, plataforma: 'android' });

  const probar = async (u: UsuarioDePrueba): Promise<PruebaDePush> => {
    const res = await a
      .http()
      .post('/dispositivos/prueba')
      .set(con(u))
      .expect(200);
    await a.avisos.esperarEnvios();
    return esperarContrato<PruebaDePush>(res.body, 'PruebaDePush');
  };

  describe('Endpoints autenticados', () => {
    it.each([['jugador'], ['encargado'], ['administrador']] as const)(
      'el rol %s puede registrar, probar y dar de baja su dispositivo',
      async (rol) => {
        const u =
          rol === 'jugador'
            ? await registrarJugador(a)
            : await crearUsuario(a, rol);
        const tokenExpo = TOKEN.replace('xxxx', rol);
        const respuesta = await alta(u, tokenExpo).expect(201);
        expect(
          esperarContrato<Dispositivo>(respuesta.body, 'Dispositivo'),
        ).toEqual({
          tokenExpo,
          plataforma: 'android',
        });
        expect(await probar(u)).toEqual({ dispositivos: 1 });
        expect(expo.mensajes.map((mensaje) => mensaje.to)).toContain(tokenExpo);

        await a
          .http()
          .delete(`/dispositivos/${encodeURIComponent(tokenExpo)}`)
          .set(con(u))
          .expect(204);
        expect(await probar(u)).toEqual({ dispositivos: 0 });
      },
    );

    it('los endpoints requieren sesión', async () => {
      esperarError(
        await a
          .http()
          .post('/dispositivos')
          .send({ tokenExpo: TOKEN, plataforma: 'ios' }),
        401,
        'NO_AUTENTICADO',
      );
      esperarError(
        await a.http().post('/dispositivos/prueba'),
        401,
        'NO_AUTENTICADO',
      );
      esperarError(
        await a.http().delete(`/dispositivos/${encodeURIComponent(TOKEN)}`),
        401,
        'NO_AUTENTICADO',
      );
    });

    it('valida el token al dar de baja y el cuerpo al registrar', async () => {
      const u = await registrarJugador(a);
      esperarError(
        await a.http().delete('/dispositivos/cualquier-cosa').set(con(u)),
        400,
        'VALIDACION_FALLIDA',
      );
      esperarError(
        await a
          .http()
          .post('/dispositivos')
          .set(con(u))
          .send({ tokenExpo: TOKEN, plataforma: 'windows' }),
        400,
        'VALIDACION_FALLIDA',
      );
    });
  });

  describe('Swagger', () => {
    it('documenta las tres rutas', async () => {
      const res = await a.http().get('/docs-json').expect(200);
      const rutas = res.body.paths as Record<string, Record<string, unknown>>;
      expect(rutas['/dispositivos']?.post).toBeDefined();
      expect(rutas['/dispositivos/prueba']?.post).toBeDefined();
      const borrar = Object.entries(rutas).find(([ruta]) =>
        ruta.startsWith('/dispositivos/{'),
      );
      expect(borrar?.[1].delete).toBeDefined();
    });
  });

  describe('Eventos de negocio', () => {
    let deporteId: string;
    let espacioId: string;
    let encargado: UsuarioDePrueba;
    beforeAll(async () => {
      deporteId = (await crearDeporte(a)).id;
      encargado = await crearUsuario(a, 'encargado');
    });
    beforeEach(async () => {
      espacioId = (await crearEspacio(a, { deporteId })).id;
    });

    it('al bloquear un turno reservado, notifica al jugador afectado', async () => {
      const jugador = await registrarJugador(a);
      const tokenExpo = 'ExponentPushToken[bloqueo]';
      await alta(jugador, tokenExpo).expect(201);
      const reserva = await crearReserva(a, {
        espacioId,
        usuarioId: jugador.usuario.id,
        fecha: '2026-09-20',
        inicio: '19:00',
      });

      const respuesta = await a
        .http()
        .post('/bloqueos')
        .set(con(encargado))
        .send({
          espacioIds: [espacioId],
          fecha: '2026-09-20',
          motivo: 'Cancha anegada',
        });
      expect(respuesta.status).toBe(201);
      esperarContrato(respuesta.body, 'Bloqueo');
      await a.avisos.esperarEnvios();
      expect(expo.mensajes.map((mensaje) => mensaje.to)).toContain(tokenExpo);

      const estado = await a
        .http()
        .get(`/reservas/${reserva.id}`)
        .set(con(jugador));
      expect(estado.body.datos.estado).toBe('cancelada');
    });

    it('al cancelar una reserva, notifica al favorito del espacio liberado', async () => {
      const titular = await registrarJugador(a);
      const fan = await registrarJugador(a);
      const tokenExpo = 'ExponentPushToken[favorito]';
      await alta(fan, tokenExpo).expect(201);
      await a
        .http()
        .put(`/yo/espacios-favoritos/${espacioId}`)
        .set(con(fan))
        .expect(200);
      const reserva = await crearReserva(a, {
        espacioId,
        usuarioId: titular.usuario.id,
        fecha: '2026-09-21',
        inicio: '20:00',
      });

      await a
        .http()
        .post(`/reservas/${reserva.id}/cancelacion`)
        .set(con(titular))
        .send({})
        .expect(200);
      await a.avisos.esperarEnvios();
      expect(expo.mensajes.map((mensaje) => mensaje.to)).toContain(tokenExpo);
    });
  });
});
