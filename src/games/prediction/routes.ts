// REST endpoints for the prediction game.
//
// Mounted under /predictions. These provide an authoritative server-side path
// for creating markets, placing bets, and resolving (validating) outcomes.
//
//   GET    /predictions                 list markets (optional ?status=)
//   POST   /predictions                 create a market (admin)
//   GET    /predictions/:id/bets        list bets for a market
//   POST   /predictions/:id/bets        place a bet { user_id, option_index, amount }
//   PATCH  /predictions/:id             update { status } or { house_percentage } (admin)
//   POST   /predictions/:id/resolve     resolve a market { winning_option } (admin)
import { Router, Request, Response } from "express";
import { PredictionService } from "./service";

export function setupPredictionRoutes(): Router {
  const router = Router();

  const handle = async (res: Response, fn: () => Promise<any>) => {
    try {
      const data = await fn();
      res.json({ ok: true, data });
    } catch (e) {
      const message = (e as Error).message || "Request failed";
      res.status(400).json({ ok: false, error: message });
    }
  };

  router.get("/", (req: Request, res: Response) => {
    const status = req.query.status as any;
    handle(res, () => PredictionService.list(status));
  });

  router.post("/", (req: Request, res: Response) => {
    const { title, description, options, house_percentage, closes_at, created_by } =
      req.body ?? {};
    handle(res, () =>
      PredictionService.create({
        title,
        description,
        options,
        house_percentage,
        closes_at,
        created_by,
      })
    );
  });

  router.get("/:id/bets", (req: Request, res: Response) => {
    handle(res, () => PredictionService.listBets(req.params.id));
  });

  router.post("/:id/bets", (req: Request, res: Response) => {
    const { user_id, option_index, amount } = req.body ?? {};
    handle(res, () =>
      PredictionService.placeBet({
        prediction_id: req.params.id,
        user_id,
        option_index: Number(option_index),
        amount: Number(amount),
      })
    );
  });

  router.patch("/:id", (req: Request, res: Response) => {
    const { status, house_percentage } = req.body ?? {};
    handle(res, async () => {
      if (status !== undefined) await PredictionService.setStatus(req.params.id, status);
      if (house_percentage !== undefined)
        await PredictionService.setHousePercentage(req.params.id, Number(house_percentage));
      return { updated: true };
    });
  });

  router.post("/:id/resolve", (req: Request, res: Response) => {
    const { winning_option } = req.body ?? {};
    handle(res, () =>
      PredictionService.resolve(req.params.id, Number(winning_option))
    );
  });

  return router;
}
