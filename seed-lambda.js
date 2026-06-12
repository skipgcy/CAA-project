import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const handler = async () => {
  const products = [
    {
      productId: "P001",
      name: "Playstation 5 PRO",
      price: 1199.00,
      color: "White",
      brand: "Playstation",
      category: ["Video Games","PlayStation"],
      stock: 10,
      imageUrl:"https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_01.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_03.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_04.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_05.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_06.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_07.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_08.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_09.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_10.jpg"
            ],

      description: "Experience the future of gaming with the PlayStation 5 PRO. Featuring lightning-fast SSD, immersive VR capabilities, and seamless online play.",
      specification: ["Way better than the previous model",
                      "Next Generation Gaming",
                      "High-Performance Processor",
                      "Perfect gift for your kids",
                      "You'll be the role model of parents in your child's friends'eyes"],
      rating: 4.8,
      reviews: 36,
    },
    {
      productId: "P002",
      name: "Apple Watch Series 11",
      price: 480.00,
      color: "Black",
      brand: "Apple",
      category: ["Watch","Smart Watches"],
      stock: 15,
      imageUrl:"https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_02.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_applewatch_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_applewatch_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_applewatch_03.jpg"
            ],
      description: "The ultimate device for a healthier lifestyle, keeping you connected, active, and safe right from your wrist.",
      specification: ["Where cutting-edge technology meets timeless style, designed to seamlessly elevate your everyday life.",
                      "Stay connected and track your fitness goals with the world's most advanced smartwatch",
                      "Your ultimate health, fitness, and connectivity companion, refined for every moment",
                      "Perfect gift for yourself or a loved one"],
      rating: 4.8,
      reviews: 50,
    },
    {
      productId: "P003",
      name: "IWC Portugieser Automatic 7 Days",
      price: 25000.00,
      color: "White and Blue",
      brand: "IWC",
      category: ["Watch","Luxury Watches"],
      stock: 2,
      imageUrl: "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_03.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_IWC_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_IWC_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_IWC_03.jpg"],
      description: "A timeless masterpiece of haute horlogerie, blending a classic railtrack minute circle with an elegant 7 days power reserve.",
      specification: ["An icon of mechanical precision, powered by a legendary in-house movement with an impressive seven-day power reserve.",
                      "The ultimate expression of executive style and horological mastery, designed for those who appreciate understated luxury.",
                      "The most expensive product in our collection."],
      rating: 5,
      reviews: 1,
    },
    {
      productId: "P004",
      name: "Apple iPhone",
      price: 1999.00,
      color: "Orange",
      brand: "Apple",
      category: ["Electronics","Smartphone"],
      stock: 12,
      imageUrl: "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_04.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_iPhone_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_iPhone_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_iPhone_03.jpg"],
      description: "Powered by the groundbreaking A19 Pro chip, it defines the next generation of smartphone performance and intelligent capability.",
      specification: ["Unleash your creativity with an all-new 48MP triple-lens camera system, delivering pro-grade photography from any distance.",
                      "A masterpiece of design featuring a stunning, ultra-bright 3,000-nit display wrapped in a premium brushed aluminum unibody."],
      rating: 4.6,
      reviews: 96
    },
    {
      productId: "P005",
      name: "Cuktech Charger",
      price: 89.99,
      color: "Grey",
      brand: "Cuktech",
      category: ["Electronics","Accessories"],
      stock: 20,
      imageUrl: "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_05.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_charger_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_charger_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_charger_03.jpg"],
      description: "A pocket-sized powerhouse delivering blazing-fast fast charging and real-time smart display insights on the go.",
      specification: ["Smaller than a credit card yet packed with ultra-fast power, it's the ultimate compact charging companion for your daily hustle.",
                      "Experience high-speed charging and smart TFT display monitoring in an ultra-compact, travel-ready design.",
                      "Pocketable ultra-fast power with a smart display—engineered for life on the move."],
      rating: 3.2,
      reviews: 580
    },
    {
      productId: "P006",
      name: "Apple iPad",
      price: 1050.00,
      color: "Green",
      brand: "Apple",
      category: ["Electronics","Tablets"],
      stock: 22,
      imageUrl: "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_06.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_iPad_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_iPad_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_iPad_03.jpg"],
      description: "A tablet that combines the power of a computer with the portability of a smartphone, perfect for work, play, and everything in between.",
      specification: ["Supercharged by the M-series chip, it packs incredible pro performance into an ultra-portable 11-inch design.",
                      "The ultimate companion for work, study, and creativity, blending a stunning 11-inch display with effortless versatility.",
                      "Light, fast, and powerful—the perfect 11-inch balance of pro capability and everyday portability."],
      rating: 2.2,
      reviews: 134
    },
    {
      productId: "P007",
      name: "TP-Link Security Camera",
      price: 29.99,
      color: "White",
      brand: "TP-Link",
      category: ["Smart Home","Security"],
      stock: 100,
      imageUrl: "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_07.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_security_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_security_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_security_03.jpg"],
      description: "Protect what matters most with 1080p Full HD clarity, advanced night vision, and instant motion alerts delivered straight to your phone.",
      specification: ["1080p Full HD resolution for crystal-clear video quality.",
                      "Advanced night vision technology for clear visibility in low-light conditions.",
                      "Instant motion alerts delivered directly to your smartphone."],
      rating: 1.1,
      reviews: 34
    },
    {
      productId: "P008",
      name: "Xiaomi 15 Ultra",
      price: 1050.00,
      color: "White",
      brand: "Xiaomi",
      category: ["Electronics","Smartphone"],
      stock: 26,
      imageUrl: "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_08.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_xiaomi_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_xiaomi_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_xiaomi_03.jpg"],
      description: "Powered by the Snapdragon 8 Elite, it fuses ultimate computing power with professional Leica optics for unmatched storytelling.",
      specification: ["A quantum leap in mobile imaging, featuring a Leica 1-inch main sensor and a revolutionary 200MP periscope telephoto lens.",
                      "Capture the world with authentic Leica aesthetics, delivering unparalleled light, shadow, and detail across all focal lengths.",
                      "The ultimate camera smartphone—redefined with a Leica quad-camera system and 200MP ultra-telephoto power."],
      rating: 4.0,
      reviews: 596
    },
    {
      productId: "P009",
      name: "SNK QingLong Mechanical Keyboard",
      price: 99.00,
      color: "White and Blue",
      brand: "SNK",
      category: ["Electronics","Accessories"],
      stock: 49,
      imageUrl: "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/shop_09.jpg",
      image: ["https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_keyboard_01.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_keyboard_02.jpg",
              "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com/assets/img/product_single_keyboard_03.jpg"],
      description: "Engineered for victory, featuring ultra-responsive mechanical switches and low-latency performance built for competitive gaming.",
      specification: ["Experience the ultimate typing comfort with a premium Gasket structure and custom-tuned switches that sound as good as they feel.",
                      "Unleash the power of the Azure Dragon—where SNK legacy meets premium mechanical performance."],
      rating: 3.3,
      reviews: 126
    },
  ];

  const requests = products.map((p) => ({
    PutRequest: {
      Item: {
        PK: "PRODUCT",
        SK: p.productId,

        productId: p.productId,
        name: p.name,
        price: p.price,
        color: p.color,
        brand: p.brand,
        category: p.category,
        stock: p.stock,
        images: p.image,
        imageUrl: p.imageUrl,
        description: p.description,
        specification: p.specification,
        rating: p.rating,
        reviews: p.reviews
      }
    }
  }));

  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        Ecommerce: requests
      }
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Seed data inserted successfully",
      count: products.length
    })
  };
};