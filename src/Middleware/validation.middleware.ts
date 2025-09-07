import Joi from 'joi';
import type { Request, Response, NextFunction } from 'express';

export function validateRequest(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation error',
          details: error.details.map(detail => detail.message)
        }
      });
    }
    next();
  };
}

export const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
});

export const loginSchema = Joi.object({
  method: Joi.string().valid('email', 'google').required(),
  email: Joi.string().email().when('method', { is: 'email', then: Joi.required() }),
  password: Joi.string().when('method', { is: 'email', then: Joi.required() }),
  idToken: Joi.string().when('method', { is: 'google', then: Joi.required() }),
  deviceInfo: Joi.object().optional(),
});
