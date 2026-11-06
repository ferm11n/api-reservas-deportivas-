# Notificaciones locales y push

La aplicación tiene dos mecanismos distintos:

- **Notificación local:** al reservar un turno, la app programa un recordatorio para dos horas
  antes, siempre que ese momento todavía sea futuro y el usuario conceda permiso. Se programa
  en el dispositivo y no necesita que la API envíe un aviso cuando llega la hora.
- **Push remota:** la API registra los tokens de los dispositivos y decide cuándo y a quién avisar:
  cuando un bloqueo suspende una reserva confirmada y cuando se libera un turno de un espacio
  favorito. No se avisa a quien canceló su propia reserva.

La parte de push remota está implementada en la app y en la API, pero su entrega en un dispositivo
depende de que estén configuradas las credenciales de plataforma en EAS. La API persiste los
tokens de Expo en la tabla `dispositivos`, envía mensajes a Expo en tandas de hasta 100 y elimina
los tokens que reciben `DeviceNotRegistered`. Un fallo del proveedor se registra sin interrumpir
la operación principal de reservas.

## Rutas de dispositivos

Todas requieren sesión:

| Método y ruta                     | Comportamiento                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /dispositivos`              | Registra `{ "tokenExpo": "ExponentPushToken[...]","plataforma":"android" }`. Es idempotente; si el token ya pertenecía a otra cuenta, se reasigna al usuario autenticado. |
| `DELETE /dispositivos/:tokenExpo` | Da de baja el token del usuario autenticado. Responde `204`, incluso si el token no estaba registrado o pertenece a otra cuenta.                                          |
| `POST /dispositivos/prueba`       | Solicita una push de prueba y devuelve cuántos tokens del usuario encontró. La respuesta no confirma la entrega en el dispositivo.                                        |

## Configuración de la API

En el entorno desplegado:

- Configurá `NOTIFICACIONES=expo`.
- `EXPO_PUSH_URL` es opcional; por defecto apunta a la API de Expo.
- La base de datos debe ser persistente y tener creada la tabla `dispositivos`. En instalaciones
  que no usan sincronización automática, aplicá la actualización de esquema antes de desplegar.
- `NOTIFICACIONES=registro` no envía notificaciones; deja constancia en el log. Es el valor del
  `.env.example` de desarrollo. El blueprint de Render usa `NOTIFICACIONES=expo`.

## Configuración y comportamiento de la app

La app solicita permiso y registra el token de Expo al iniciar una sesión autenticada. Al cerrar
sesión intenta eliminar el token de la API, pero un error de red no impide completar el cierre de
sesión. Las notificaciones push también se muestran cuando la app está en primer plano.

Las notificaciones locales siguen disponibles en Expo Go. Para probar push remotas en Android se
requiere un development build o build de release; no están disponibles en Expo Go desde SDK 53.
Un emulador Android necesita Google Play Services; un dispositivo real debe tener servicios
compatibles.

Para recibir push remotas, configurá las credenciales de la plataforma en EAS (FCM v1 para
Android y APNs para iOS). El plugin `expo-notifications` ya está incluido en `app.json`; si se
cambia su configuración nativa, generá un build nuevo.

## Pruebas

Los tests de `test/notifications/` validan los endpoints con una base real y el envío contra un
servidor Expo falso, sin salir a Internet:

```bash
pnpm test:notificaciones
```

Para la prueba manual:

1. Levantá la API con `NOTIFICACIONES=expo` y una base persistente.
2. Instalá un development build reciente, iniciá sesión y aceptá el permiso del sistema.
3. Usá `POST /dispositivos/prueba` en Swagger. Un resultado `dispositivos: 0` indica que no hay
   tokens asociados a ese usuario; un valor mayor que cero sólo confirma que se encontraron
   tokens y que se inició el envío, no la entrega en el teléfono.
4. Probá los flujos reales: suspender una reserva con un bloqueo o liberar un turno de un espacio
   favorito. Confirmá la notificación en el dispositivo y revisá los logs de la API si no llega.

La app necesita conectividad con la API para registrar el token y recibir avisos remotos. Para
mostrar la notificación local de recordatorio, elegí al reservar un turno cuyo inicio sea al menos
dos horas en el futuro y concedé el permiso de notificaciones.

La app toma el `projectId` de `extra.eas.projectId` en `app.json`. La URL base de la API debe ser
accesible desde el teléfono; no uses `localhost` para el emulador/dispositivo.

## Referencias

- Expo Notifications SDK 57: <https://docs.expo.dev/versions/v57.0.0/sdk/notifications/>
- Envío de push: <https://docs.expo.dev/push-notifications/sending-notifications/>
- Credenciales de push: <https://docs.expo.dev/push-notifications/push-notifications-setup/>
- Herramienta para probar: <https://expo.dev/notifications>
