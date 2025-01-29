import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { faker } from "@faker-js/faker";
import yaml from "yaml";

const fastify = Fastify({
  logger: true,
  ajv: {
    customOptions: {
      removeAdditional: false,
      useDefaults: true,
      coerceTypes: true,
      allErrors: true,
    },
  },
});

// Shared Schemas
const productSchema = {
  $id: "product",
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    color: { type: "string" },
    size: { type: "string", enum: ["S", "M", "L", "XL"] },
    price: { type: "number" },
    stock: { type: "integer" },
  },
};

const cartItemSchema = {
  $id: "cartItem",
  type: "object",
  properties: {
    productId: { type: "string" },
    quantity: { type: "integer", minimum: 1 },
  },
  required: ["productId", "quantity"],
};

// Register schemas
fastify.addSchema(productSchema);
fastify.addSchema(cartItemSchema);

// Data store
const db = {
  products: new Map(),
  cart: { items: [] }, // Single global cart
};

// Generate mock products
for (let i = 0; i < 1000; i++) {
  const product = {
    id: faker.string.uuid(),
    name: `${faker.commerce.productAdjective()} T-shirt`,
    color: faker.color.human(),
    size: faker.helpers.arrayElement(["S", "M", "L", "XL"]),
    price: parseFloat(faker.commerce.price({ min: 10, max: 100 })),
    stock: faker.number.int({ min: 0, max: 100 }),
  };
  db.products.set(product.id, product);
}

// Error handler
fastify.setErrorHandler(function (error, request, reply) {
  if (error.validation) {
    reply.status(400).send({
      statusCode: 400,
      error: "Bad Request",
      message: error.message,
    });
    return;
  }
  if (error instanceof Error) {
    reply.status(400).send({
      statusCode: 400,
      error: "Bad Request",
      message: error.message,
    });
    return;
  }
  reply.send(error);
});

// Swagger configuration
await fastify.register(swagger, {
  openapi: {
    info: {
      title: "T-shirt Store API",
      description: `
        This API provides endpoints to manage a T-shirt e-commerce store.
        Features supported:
        - Product listing with filtering
        - Product details
        - Shopping cart management (global cart)
        - Stock management
        - Pagination support for listings
      `,
      version: "1.0.0",
    },
  },
});

await fastify.register(swaggerUi, {
  routePrefix: "/api-docs",
});

// Product routes
fastify.get("/product/list", {
  schema: {
    querystring: {
      type: "object",
      properties: {
        name: { type: "string" },
        color: { type: "string" },
        size: { type: "string", enum: ["S", "M", "L", "XL"] },
        price: { type: "number" },
        offset: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
    },
    response: {
      200: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { $ref: "product#" },
          },
          total: { type: "integer" },
        },
      },
    },
  },
  handler: async (request) => {
    const { name, color, size, price, offset = 0, limit = 10 } = request.query;
    let products = Array.from(db.products.values());

    if (name)
      products = products.filter((p) =>
        p.name.toLowerCase().includes(name.toLowerCase()),
      );
    if (color)
      products = products.filter(
        (p) => p.color.toLowerCase() === color.toLowerCase(),
      );
    if (size) products = products.filter((p) => p.size === size);
    if (price) products = products.filter((p) => p.price <= price);

    return {
      items: products.slice(offset, offset + limit),
      total: products.length,
    };
  },
});

fastify.get("/product/:id", {
  schema: {
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    response: {
      200: { $ref: "product#" },
    },
  },
  handler: async (request) => {
    const product = db.products.get(request.params.id);
    if (!product) throw new Error("Product not found");
    return product;
  },
});

// Cart routes
fastify.post("/cart/add", {
  schema: {
    body: { $ref: "cartItem#" },
    response: {
      200: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
      },
    },
  },
  handler: async (request) => {
    const { productId, quantity } = request.body;
    const product = db.products.get(productId);

    if (!product) throw new Error("Product not found");
    if (product.stock < quantity) throw new Error("Insufficient stock");

    const existingItem = db.cart.items.find(
      (item) => item.productId === productId,
    );
    if (existingItem) {
      if (product.stock < quantity + existingItem.quantity) {
        throw new Error("Insufficient stock");
      }
      existingItem.quantity += quantity;
    } else {
      db.cart.items.push({ productId, quantity });
    }

    product.stock -= quantity;

    return { message: "Item added to cart" };
  },
});

fastify.post("/cart/remove", {
  schema: {
    body: {
      type: "object",
      properties: {
        productId: { type: "string" },
      },
      required: ["productId"],
    },
    response: {
      200: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
      },
    },
  },
  handler: async (request) => {
    const { productId } = request.body;
    const itemIndex = db.cart.items.findIndex(
      (item) => item.productId === productId,
    );

    if (itemIndex === -1) throw new Error("Item not in cart");

    const product = db.products.get(productId);
    product.stock += db.cart.items[itemIndex].quantity;

    db.cart.items.splice(itemIndex, 1);

    return { message: "Item removed from cart" };
  },
});

fastify.post("/cart/update", {
  schema: {
    body: { $ref: "cartItem#" },
    response: {
      200: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
      },
    },
  },
  handler: async (request) => {
    const { productId, quantity } = request.body;
    const product = db.products.get(productId);

    if (!product) throw new Error("Product not found");

    const existingItem = db.cart.items.find(
      (item) => item.productId === productId,
    );
    if (!existingItem) throw new Error("Item not in cart");

    const stockDiff = quantity - existingItem.quantity;
    if (product.stock < stockDiff) throw new Error("Insufficient stock");

    product.stock -= stockDiff;
    existingItem.quantity = quantity;

    return { message: "Cart updated" };
  },
});

fastify.get("/cart/list", {
  schema: {
    querystring: {
      type: "object",
      properties: {
        offset: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
    },
    response: {
      200: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product: { $ref: "product#" },
                quantity: { type: "integer" },
              },
            },
          },
          total: { type: "integer" },
        },
      },
    },
  },
  handler: async (request) => {
    const { offset = 0, limit = 10 } = request.query;
    const items = db.cart.items.slice(offset, offset + limit).map((item) => ({
      product: db.products.get(item.productId),
      quantity: item.quantity,
    }));

    return {
      items,
      total: db.cart.items.length,
    };
  },
});

fastify.post("/cart/checkout", {
  schema: {
    response: {
      200: {
        type: "object",
        properties: {
          orderId: { type: "string" },
          total: { type: "number" },
        },
      },
    },
  },
  handler: async (request) => {
    if (db.cart.items.length === 0) {
      throw new Error("Cart is empty");
    }

    const total = db.cart.items.reduce((sum, item) => {
      const product = db.products.get(item.productId);
      return sum + product.price * item.quantity;
    }, 0);

    // Clear the cart after checkout
    const orderId = faker.string.uuid();
    db.cart.items = [];

    return {
      orderId,
      total,
    };
  },
});

// Generate OpenAPI spec
fastify.get("/api-spec.yaml", async (request, reply) => {
  const yamlString = yaml.stringify(fastify.swagger());
  reply.header("Content-Type", "text/yaml").send(yamlString);
});

// Start server
try {
  await fastify.listen({ port: 3000 });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
