varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - world.xyz;
  vHeight = world.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
