import { Router } from 'express';
import * as logsController from '../controllers/logsController';
import { requiereAdmin } from '../middleware/auth';

// Rutas PRIVADAS: las peticiones a la API con su IP, para el apartado Logs de la app (Más → Logs)
const router = Router();
router.use(requiereAdmin);

router.get('/', logsController.listar);
router.delete('/', logsController.borrarTodo);
router.get('/resumen', logsController.resumen);
router.get('/visitas', logsController.visitas);
router.get('/ips', logsController.ips);
router.put('/ips/:ip', logsController.nombrarIp);
router.delete('/ips/:ip', logsController.olvidarIp);
router.get('/borrado-automatico', logsController.obtenerDias);
router.put('/borrado-automatico', logsController.cambiarDias);

export default router;
