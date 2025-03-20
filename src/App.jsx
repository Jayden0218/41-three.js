import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js";
import * as THREE from "three";
import particlesVertexShader from "./shaders/vertex.glsl";
import particlesFragmentShader from "./shaders/fragment.glsl";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import gpgpuParticlesShader from "./shaders/particles.glsl";
import { Canvas } from "@react-three/fiber";

function GPGPU() {
  // Leva Controls
  const {
    clearColor,
    uSize,
    uFlowFieldFrequency,
    uFlowFieldInfluence,
    uFlowFieldStrength,
  } = useControls({
    clearColor: "#29191f",
    uSize: { value: 0.03, min: 0, max: 1, step: 0.001 },
    uFlowFieldInfluence: { value: 0.03, min: 0, max: 1, step: 0.001 },
    uFlowFieldStrength: { value: 0.03, min: 0, max: 1, step: 0.001 },
    uFlowFieldFrequency: { value: 0.03, min: 0, max: 1, step: 0.001 },
  });

  // DracoLoader
  const gltf = useGLTF("/model.glb", { useDraco: true });

  // Get properties from useThree
  const { size, dpr, gl } = useThree((state) => ({
    size: state.size,
    dpr: state.dpr,
    gl: state.gl,
  }));

  // Uniforms
  const uniforms = useMemo(
    () => ({
      uSize: new THREE.Uniform(uSize),
      uResolution: new THREE.Uniform(
        new THREE.Vector2(size.width * dpr, size.height * dpr)
      ),
      uParticlesTexture: new THREE.Uniform(),
    }),
    []
  );

  // Resize trigger
  useEffect(() => {
    shaderMaterialRef.current.uniforms.uResolution.value.set(
      size.width * dpr,
      size.height * dpr
    );
  }, [size]);

  // Controls update
  useEffect(() => {
    gl.setClearColor(clearColor);
    if (shaderMaterialRef.current) {
      // console.log(bufferGeomtryRef.current);
      shaderMaterialRef.current.uniforms.uSize.value = uSize;
    }
  }, [clearColor, uSize]);

  // References
  const bufferGeomtryRef = useRef();
  const shaderMaterialRef = useRef();
  const meshBasicRef = useRef();

  // Base Geometry
  const baseGeometry = useMemo(() => {
    const instance = gltf.scene.children[0].geometry;
    return {
      instance,
      count: instance.attributes.position.count,
    };
  }, [gltf]);

  // GPGPU Compute
  const gpgpu = useMemo(() => {
    const gpgpuSize = Math.ceil(Math.sqrt(baseGeometry.count));
    const computation = new GPUComputationRenderer(gpgpuSize, gpgpuSize, gl);

    // Base particles
    const baseParticlesTexture = computation.createTexture();

    return {
      gpgpuSize,
      computation,
      baseParticlesTexture,
    };
  }, [baseGeometry.count, gl]);

  // Calculation
  useMemo(() => {
    for (let i = 0; i < baseGeometry.count; i++) {
      const i3 = i * 3;
      const i4 = i * 4;

      // Position based on geometry
      gpgpu.baseParticlesTexture.image.data[i4 + 0] =
        baseGeometry.instance.attributes.position.array[i3 + 0];
      gpgpu.baseParticlesTexture.image.data[i4 + 1] =
        baseGeometry.instance.attributes.position.array[i3 + 1];
      gpgpu.baseParticlesTexture.image.data[i4 + 2] =
        baseGeometry.instance.attributes.position.array[i3 + 2];
      gpgpu.baseParticlesTexture.image.data[i4 + 3] = Math.random();
    }
  }, []);

  const particlesVariable = useMemo(() => {
    const variable = gpgpu.computation.addVariable(
      "uParticles",
      gpgpuParticlesShader,
      gpgpu.baseParticlesTexture
    );

    gpgpu.computation.setVariableDependencies(variable, [variable]);

    return variable;
  }, []);

  // Uniforms for gpgpu
  useEffect(() => {
    particlesVariable.material.uniforms.uTime = new THREE.Uniform(0);
    particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0);
    particlesVariable.material.uniforms.uBase = new THREE.Uniform(
      gpgpu.baseParticlesTexture
    );
    particlesVariable.material.uniforms.uFlowFieldInfluence = new THREE.Uniform(
      uFlowFieldInfluence
    );
    particlesVariable.material.uniforms.uFlowFieldStrength = new THREE.Uniform(
      uFlowFieldStrength
    );
    particlesVariable.material.uniforms.uFlowFieldFrequency = new THREE.Uniform(
      uFlowFieldFrequency
    );

    gpgpu.computation.init();
  }, []);

  // Particles
  useEffect(() => {
    // Geomtetry
    const particlesUvArray = new Float32Array(baseGeometry.count * 2);
    const sizesArray = new Float32Array(baseGeometry.count);

    for (let y = 0; y < gpgpu.size; y++) {
      for (let x = 0; x < gpgpu.size; x++) {
        const i = y * gpgpu.size + x;
        const i2 = i * 2;

        // UV
        const uvX = (x + 0.5) / gpgpu.size;
        const uvY = (y + 0.5) / gpgpu.size;

        particlesUvArray[i2 + 0] = uvX;
        particlesUvArray[i2 + 1] = uvY;

        // Size
        sizesArray[i] = Math.random();
      }
    }

    bufferGeomtryRef.current.setDrawRange(0, baseGeometry.count);
    bufferGeomtryRef.current.setAttribute(
      "aParticlesUv",
      new THREE.BufferAttribute(particlesUvArray, 2)
    );
    bufferGeomtryRef.current.setAttribute(
      "aColor",
      baseGeometry.instance.attributes.color
    );
    bufferGeomtryRef.current.setAttribute(
      "aSize",
      new THREE.BufferAttribute(sizesArray, 1)
    );
  }, [baseGeometry.count, baseGeometry.instance.attributes.color, gpgpu.size]);

  useEffect(() => {
    meshBasicRef.current.map =
      gpgpu.computation.getCurrentRenderTarget(particlesVariable).texture;
  }, [gpgpu.computation, particlesVariable]);

  useFrame((_, delta) => {
    if (particlesVariable) {
      particlesVariable.material.uniforms.uTime.value = delta;
      particlesVariable.material.uniforms.uDeltaTime.value = delta;
      gpgpu.computation.compute();
      if (shaderMaterialRef.current) {
        shaderMaterialRef.current.uniforms.uParticlesTexture.value =
          gpgpu.computation.getCurrentRenderTarget(particlesVariable).texture;
      }
    }
  });

  return (
    <>
      <mesh position-x={3} visible={false}>
        <planeGeometry args={[3, 3]} />
        <meshBasicMaterial ref={meshBasicRef} />
      </mesh>

      <points>
        <bufferGeometry ref={bufferGeomtryRef} />
        <shaderMaterial
          ref={shaderMaterialRef}
          vertexShader={particlesVertexShader}
          fragmentShader={particlesFragmentShader}
          uniforms={uniforms}
        />
      </points>
    </>
  );
}

function App() {
  return (
    <Canvas camera={{ fov: 35, position: [4.5, 4, 11] }}>
      <OrbitControls enableDamping />
      <GPGPU />
    </Canvas>
  );
}

export default App;
