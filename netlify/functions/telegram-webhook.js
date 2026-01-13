exports.handler = async (event) => {
    console.log("LOG DE PRUEBA: La función responde");
    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Si ves esto, las dependencias están BIEN" })
    };
};